import { api } from "./api.js";
import * as cryptoUtil from "./crypto.js";

const STORAGE_KEY = "drivetrack_session";

// --- Zustand ---
let session = loadSession(); // { token, username, email, passwordSalt, dekWrappedPassword } | null
let dek = null; // NIE persistiert, nur im Speicher dieser Seite
let backupData = { users: [], cars: [], trips: [], groups: [] };
let selectedCarId = "";
let currentTab = "home";
let mainMap = null;
let mainMapLayers = [];
let detailMap = null;
let graphScrubMarker = null; // Leaflet-Marker auf detailMap, zeigt die im Graph gewählte Position
let currentGraphRedraw = null; // Redraw-Funktion der gerade offenen Fahrt, für den globalen Resize-Handler
let currentDetailTrip = null; // Fahrt der gerade offenen Detail-Ansicht, für den Farbmodus-Umschalter
let routeLineLayers = []; // Aktuell auf detailMap gezeichnete Routen-Layer (Linie(n) + Hover-Trefferfläche)
// Fahrten-Gruppen (seit v1.9.0) - siehe TripGrouping.kt in der App
let groupMap = null; // Leaflet-Karte in #trip-group-screen (eigene Instanz, spiegelt detailMap)
let groupGraphScrubMarker = null;
let currentGroupGraphRedraw = null;
let currentGroupTrips = null; // Mitgliedsfahrten der gerade offenen Gruppe, für den Farbmodus-Umschalter
let currentGroup = null; // Gruppe der gerade offenen Gruppen-Detailseite
let groupRouteLineLayers = [];
let groupPickerTargetId = null; // null = Erstellen-Modus, sonst Hinzufügen-Modus zu dieser Gruppe

// --- Session-Verwaltung (localStorage: nur Token/Salt/verpackter DEK, nie Passwort/DEK selbst) ---
function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveSession(s) {
  session = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
function clearSession() {
  session = null;
  dek = null;
  localStorage.removeItem(STORAGE_KEY);
}

// --- Screens ---
const screens = {
  login: document.getElementById("login-screen"),
  register: document.getElementById("register-screen"),
  forgot: document.getElementById("forgot-screen"),
  unlock: document.getElementById("unlock-screen"),
  main: document.getElementById("main-app"),
  detail: document.getElementById("trip-detail-screen"),
  edit: document.getElementById("trip-edit-screen"),
  group: document.getElementById("trip-group-screen"),
  groupRoute: document.getElementById("trip-group-route-screen"),
  groupPicker: document.getElementById("trip-group-picker-screen"),
  settings: document.getElementById("settings-screen"),
};
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// --- Boot ---
async function boot() {
  if (!session) {
    showScreen("login");
    return;
  }
  document.getElementById("unlock-hint").textContent =
    `Eingeloggt als "${session.username}". Gib dein Passwort erneut ein, um deine Backups zu entschlüsseln.`;
  showScreen("unlock");
}

// --- Login ---
document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  if (!username || !password) return;

  try {
    const result = await api.login(username, password);
    const wrapped = cryptoUtil.wrappedStringToBlob(result.dekWrappedPassword);
    dek = await cryptoUtil.unwrapDek(wrapped, password, result.passwordSalt);
    saveSession({
      token: result.token,
      username,
      // Vorher fälschlich "session?.email" (Selbstbezug auf die noch nicht existierende Session,
      // war dadurch immer leer) - der Login-Endpunkt liefert die E-Mail jetzt selbst mit (Backend
      // v1.1.1), das ist die tatsächliche Quelle.
      email: result.email || "",
      passwordSalt: result.passwordSalt,
      dekWrappedPassword: result.dekWrappedPassword,
    });
    // Screen ZUERST sichtbar machen, dann erst die Karte aufbauen - Leaflet
    // berechnet sonst die Kachelgröße in einem noch unsichtbaren (display:none) Container falsch.
    showScreen("main");
    await loadAndRenderBackup();
  } catch (e) {
    errorEl.textContent = e.message || "Login fehlgeschlagen";
  }
});

document.getElementById("show-register").addEventListener("click", () => showScreen("register"));
document.getElementById("show-login").addEventListener("click", () => showScreen("login"));
document.getElementById("show-forgot").addEventListener("click", () => showScreen("forgot"));
document.getElementById("forgot-back-btn").addEventListener("click", () => showScreen("login"));

// --- Registrieren ---
document.getElementById("register-btn").addEventListener("click", async () => {
  const username = document.getElementById("register-username").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const password2 = document.getElementById("register-password2").value;
  const errorEl = document.getElementById("register-error");
  errorEl.textContent = "";

  if (!username || !email || !password) {
    errorEl.textContent = "Bitte alle Felder ausfüllen";
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = "Passwort muss mindestens 8 Zeichen haben";
    return;
  }
  if (password !== password2) {
    errorEl.textContent = "Passwörter stimmen nicht überein";
    return;
  }

  try {
    const newDek = cryptoUtil.randomDek();
    const recoveryCode = cryptoUtil.randomRecoveryCode();
    const passwordSalt = cryptoUtil.randomSaltBase64();
    const recoverySalt = cryptoUtil.randomSaltBase64();

    const dekWrappedPassword = cryptoUtil.blobToWrappedString(
      await cryptoUtil.wrapDek(newDek, password, passwordSalt)
    );
    const dekWrappedRecovery = cryptoUtil.blobToWrappedString(
      await cryptoUtil.wrapDek(newDek, recoveryCode, recoverySalt)
    );

    await api.register({
      username, email, password,
      dekWrappedPassword, dekWrappedRecovery,
      passwordSalt, recoverySalt, recoveryCode,
    });

    alert(`Konto angelegt! Dein Recovery-Code wurde an ${email} geschickt – bewahr die Mail gut auf.`);
    showScreen("login");
    document.getElementById("login-username").value = username;
  } catch (e) {
    errorEl.textContent = e.message || "Registrierung fehlgeschlagen";
  }
});

// --- Passwort vergessen ---
document.getElementById("forgot-request-btn").addEventListener("click", async () => {
  const email = document.getElementById("forgot-email").value.trim();
  const errorEl = document.getElementById("forgot-error");
  errorEl.textContent = "";
  if (!email) return;

  try {
    await api.requestReset(email);
    document.getElementById("forgot-step-email").classList.add("hidden");
    document.getElementById("forgot-step-reset").classList.remove("hidden");
  } catch (e) {
    // Absichtlich dieselbe Meldung wie bei Erfolg (verhindert Ausspaehen registrierter Mails)
    document.getElementById("forgot-step-email").classList.add("hidden");
    document.getElementById("forgot-step-reset").classList.remove("hidden");
  }
});

document.getElementById("forgot-reset-btn").addEventListener("click", async () => {
  const email = document.getElementById("forgot-email").value.trim();
  const code = document.getElementById("forgot-code").value.trim();
  const recoveryCode = document.getElementById("forgot-recovery-code").value.trim();
  const newPassword = document.getElementById("forgot-new-password").value;
  const newPassword2 = document.getElementById("forgot-new-password2").value;
  const errorEl = document.getElementById("forgot-error");
  errorEl.textContent = "";

  if (!code || !recoveryCode || !newPassword) {
    errorEl.textContent = "Bitte alle Felder ausfüllen";
    return;
  }
  if (newPassword.length < 8) {
    errorEl.textContent = "Passwort muss mindestens 8 Zeichen haben";
    return;
  }
  if (newPassword !== newPassword2) {
    errorEl.textContent = "Passwörter stimmen nicht überein";
    return;
  }

  try {
    const verifyResult = await api.verifyResetCode(email, code);
    const wrappedRecovery = cryptoUtil.wrappedStringToBlob(verifyResult.dekWrappedRecovery);
    const recoveredDek = await cryptoUtil.unwrapDek(wrappedRecovery, recoveryCode, verifyResult.recoverySalt);

    const newPasswordSalt = cryptoUtil.randomSaltBase64();
    const newDekWrappedPassword = cryptoUtil.blobToWrappedString(
      await cryptoUtil.wrapDek(recoveredDek, newPassword, newPasswordSalt)
    );

    await api.confirmReset({
      email, code, newPassword,
      newDekWrappedPassword, newPasswordSalt,
    });

    alert("Passwort erfolgreich zurückgesetzt. Du kannst dich jetzt einloggen.");
    document.getElementById("forgot-step-email").classList.remove("hidden");
    document.getElementById("forgot-step-reset").classList.add("hidden");
    document.getElementById("login-username").value = "";
    showScreen("login");
  } catch (e) {
    errorEl.textContent = e.message || "Recovery-Code oder Code falsch";
  }
});

// --- Entsperren (nach Reload, Token schon vorhanden) ---
document.getElementById("unlock-btn").addEventListener("click", async () => {
  const password = document.getElementById("unlock-password").value;
  const errorEl = document.getElementById("unlock-error");
  errorEl.textContent = "";
  if (!password || !session) return;

  try {
    const wrapped = cryptoUtil.wrappedStringToBlob(session.dekWrappedPassword);
    dek = await cryptoUtil.unwrapDek(wrapped, password, session.passwordSalt);
    showScreen("main");
    await loadAndRenderBackup();
  } catch (e) {
    errorEl.textContent = "Falsches Passwort";
  }
});

document.getElementById("unlock-logout-btn").addEventListener("click", () => {
  clearSession();
  showScreen("login");
});
// Leichte Zwei-Klick-Bestätigung statt sofortigem Abmelden: erster Klick ändert den Button-Text
// kurz zu "Wirklich abmelden?", verfällt nach ein paar Sekunden zurück, falls nicht bestätigt.
let logoutConfirmTimeout = null;
const logoutBtn = document.getElementById("settings-logout-btn");
logoutBtn.addEventListener("click", () => {
  if (logoutBtn.dataset.confirming === "1") {
    clearTimeout(logoutConfirmTimeout);
    logoutBtn.dataset.confirming = "0";
    logoutBtn.textContent = "Abmelden";
    clearSession();
    showScreen("login");
  } else {
    logoutBtn.dataset.confirming = "1";
    logoutBtn.textContent = "Wirklich abmelden?";
    logoutConfirmTimeout = setTimeout(() => {
      logoutBtn.dataset.confirming = "0";
      logoutBtn.textContent = "Abmelden";
    }, 3000);
  }
});

// --- Backup laden & entschlüsseln ---
async function loadAndRenderBackup() {
  if (!session || !dek) return;
  const result = await api.downloadBackup(session.token);
  const blob = { ciphertextBase64: result.ciphertext, ivBase64: result.iv };
  const json = await cryptoUtil.decryptWithDek(blob, dek);
  const parsed = JSON.parse(json);
  backupData = {
    users: parsed.users || [],
    cars: parsed.cars || [],
    trips: parsed.trips || [],
    groups: parsed.groups || [],
  };
  if (result.id != null) setLastKnownBackupId(result.id);
  renderCarSelector();
  renderTab();
}

// --- Schreibpfad (seit v1.7.0) ---
// Pendant zu ServerAuthPreferences.getLastKnownBackupId()/setLastKnownBackupId() in der App -
// die Server-Backup-"id", die dieses Gerät (dieser Browser) zuletzt gesehen/gepusht hat.
const LAST_KNOWN_BACKUP_ID_KEY = "drivetrack_last_known_backup_id";
function getLastKnownBackupId() {
  const v = localStorage.getItem(LAST_KNOWN_BACKUP_ID_KEY);
  return v === null ? null : Number(v);
}
function setLastKnownBackupId(id) {
  localStorage.setItem(LAST_KNOWN_BACKUP_ID_KEY, String(id));
}

/** Kleinste freie Id für neu eingefügte Users/Cars beim additiven Merge (siehe unten). */
function nextLocalId(list) {
  return list.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;
}

/**
 * Übernimmt eine Remote-Backup-Version in `target` (mutiert in place): Trips über Start-/
 * Endzeitpunkt abgeglichen, Users/Cars über Namen. Bestehende Fahrten werden dabei ÜBERSCHRIEBEN
 * (nicht nur ergänzt) - Grund: ein rein additiver Merge (frühere Variante dieser Funktion) hätte
 * Bearbeitungen an einer schon bekannten Fahrt (z.B. Labels/Markierungen von der App) beim Web-
 * seitigen Speichern stillschweigend ignoriert, weil "gleicher Start-/Endzeitpunkt" als reines
 * Duplikat behandelt wurde, statt die neueren Werte zu übernehmen - genau das ließ "Aktualisieren"
 * wirkungslos aussehen. Users/Cars bleiben bewusst additiv (nie überschrieben) - Namens-Overwrites
 * dort wären riskanter als nützlich. Trips tragen bewusst kein "id"-Feld im Backup-JSON (App
 * re-identifiziert sie beim Import über Start-/Endzeitpunkt) - hier genauso. Gibt zurück, wie viele
 * Fahrten überschrieben bzw. neu ergänzt wurden.
 */
function mergeBackupDataOverwrite(target, remote) {
  const userIdMap = new Map();
  (remote.users || []).forEach((u) => {
    const existing = target.users.find((tu) => tu.name.toLowerCase() === u.name.toLowerCase());
    if (existing) {
      userIdMap.set(u.id, existing.id);
    } else {
      const newId = nextLocalId(target.users);
      target.users.push({ id: newId, name: u.name });
      userIdMap.set(u.id, newId);
    }
  });

  const carIdMap = new Map();
  (remote.cars || []).forEach((c) => {
    const existing = target.cars.find((tc) => tc.name.toLowerCase() === c.name.toLowerCase());
    if (existing) {
      carIdMap.set(c.id, existing.id);
    } else {
      const newId = nextLocalId(target.cars);
      target.cars.push({ id: newId, name: c.name });
      carIdMap.set(c.id, newId);
    }
  });

  // Gruppen (seit v1.9.0) - exakt dasselbe Muster wie carIdMap oben, spiegelt groupIdMap in
  // BackupExporter.kt der App.
  if (!target.groups) target.groups = [];
  const groupIdMap = new Map();
  (remote.groups || []).forEach((g) => {
    const existing = target.groups.find((tg) => tg.name.toLowerCase() === g.name.toLowerCase());
    if (existing) {
      groupIdMap.set(g.id, existing.id);
    } else {
      const newId = nextLocalId(target.groups);
      target.groups.push({ id: newId, name: g.name });
      groupIdMap.set(g.id, newId);
    }
  });

  let overwritten = 0;
  let added = 0;
  (remote.trips || []).forEach((t) => {
    const newCarId = t.carId != null && carIdMap.has(t.carId) ? carIdMap.get(t.carId) : null;
    const newGroupId = t.groupId != null && groupIdMap.has(t.groupId) ? groupIdMap.get(t.groupId) : null;
    const tripObj = { ...t, carId: newCarId, groupId: newGroupId };
    const existingIdx = target.trips.findIndex(
      (existing) => existing.startTimestamp === t.startTimestamp && existing.endTimestamp === t.endTimestamp
    );
    if (existingIdx !== -1) {
      target.trips[existingIdx] = tripObj;
      overwritten++;
    } else {
      target.trips.push(tripObj);
      added++;
    }
  });

  return { overwritten, added };
}

/**
 * Pull-Check-Merge-Push, identisch zu ServerSync.syncFullBackupIfPossible() in der App: lädt erst
 * die aktuellste Server-Version, vergleicht ihre Id mit der zuletzt bekannten. Weicht sie ab (ein
 * anderes Gerät - z.B. das Handy - hat inzwischen gepusht), wird sie erst in `backupData`
 * übernommen (mergeBackupDataOverwrite() - überschreibt bekannte Fahrten mit dem neueren Stand,
 * ergänzt nur wirklich neue), BEVOR der eigentliche Push passiert - sonst würde jeder
 * Speichervorgang unbemerkt Bearbeitungen von woanders überschreiben. Wirft bei einem Fehler
 * (anders als die App, die das still verschluckt) - hier soll ein fehlgeschlagenes Speichern dem
 * Nutzer sichtbar gemeldet werden.
 */
async function pushBackupConflictSafe() {
  if (!session || !dek) throw new Error("Nicht eingeloggt/entsperrt");

  const latest = await api.downloadBackup(session.token).catch(() => null);
  if (latest && latest.id != null) {
    const lastKnown = getLastKnownBackupId();
    if (Number(latest.id) !== Number(lastKnown)) {
      const blob = { ciphertextBase64: latest.ciphertext, ivBase64: latest.iv };
      const remoteJson = await cryptoUtil.decryptWithDek(blob, dek);
      mergeBackupDataOverwrite(backupData, JSON.parse(remoteJson));
    }
  }

  const json = JSON.stringify({
    version: 1,
    users: backupData.users,
    cars: backupData.cars,
    trips: backupData.trips,
    groups: backupData.groups,
  });
  const encrypted = await cryptoUtil.encryptWithDek(json, dek);
  const uploadResult = await api.uploadBackup(session.token, encrypted.ciphertextBase64, encrypted.ivBase64);
  if (uploadResult && uploadResult.id != null) setLastKnownBackupId(uploadResult.id);

  renderCarSelector();
  renderTab();
}

document.getElementById("settings-reload-btn").addEventListener("click", async () => {
  await loadAndRenderBackup();
  // Kurze eingeblendete Status-Meldung statt eines nativen alert() (einzige Stelle der ganzen
  // App, die bisher alert() genutzt hat - passt nicht zum sonstigen Stil mit .error-text-Divs etc.).
  const statusEl = document.getElementById("settings-reload-status");
  statusEl.classList.remove("hidden");
  setTimeout(() => statusEl.classList.add("hidden"), 2500);
});

// "Jetzt aktualisieren" direkt in der Kopfzeile (seit v1.8.0) - Pendant zum Runterziehen in der
// App, damit man nicht erst in die Einstellungen muss, um mit anderen Geräten aktuell zu bleiben.
// Rein lesend (loadAndRenderBackup() pullt nur) - lokale Bearbeitungen werden bereits beim
// Speichern selbst hochgeladen (pushBackupConflictSafe()), kein zusätzlicher Push hier nötig.
document.getElementById("refresh-btn").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-btn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "🔄 Aktualisiere…";
  try {
    await loadAndRenderBackup();
    // Kurzes sichtbares Feedback, sonst wirkt der Klick wirkungslos, wenn sich gerade nichts
    // geändert hat (fühlt sich sonst wie ein Bug an statt wie "es gibt nichts Neues").
    btn.textContent = "✓ Aktualisiert";
    setTimeout(() => { btn.textContent = originalText; }, 1200);
  } catch (e) {
    btn.textContent = originalText;
    // still, kein alert() nötig - loadAndRenderBackup() lässt den bisherigen Stand einfach stehen
  } finally {
    btn.disabled = false;
  }
});

// Einzige Quelle der Wahrheit für die Versionsnummer ist der <meta name="app-version">-Tag in
// index.html (kein Build-Step hier, der eine Konstante an mehreren Stellen einsetzen könnte).
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "?";
document.getElementById("settings-version-label").textContent = `Version ${APP_VERSION}`;
document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-username-value").textContent = session?.username || "–";
  document.getElementById("settings-email-value").textContent = session?.email || "–";
  showScreen("settings");
});
document.getElementById("settings-back").addEventListener("click", () => showScreen("main"));

// --- Versionsverlauf (seit v1.7.0) ---
// "Backup-Sicherung ohne Bearbeitungen, die bei Konflikten greift": jede zuvor gesicherte Version
// bleibt für immer erhalten (POST /api/backup fügt beim Backend nur hinzu, überschreibt nie) -
// hier als manueller Wiederherstellen-Hebel freigelegt, Pendant zu ServerBackupScreen.kt in der App.

/**
 * Setzt Fahrten mit übereinstimmender Start-/Endzeit gezielt auf den Stand der gewählten
 * (i.d.R. älteren) Version zurück - der eigentliche Zweck des Versionsverlaufs. Dünner Wrapper um
 * mergeBackupDataOverwrite() (dieselbe Überschreiben-Semantik, die auch der normale konfliktsichere
 * Push nutzt), mutiert backupData in place.
 */
function restoreFromJsonWeb(jsonText) {
  const remote = JSON.parse(jsonText);
  const { overwritten, added } = mergeBackupDataOverwrite(backupData, remote);
  return { restored: overwritten, added };
}

document.getElementById("settings-history-btn").addEventListener("click", async () => {
  if (!session || !dek) return;
  const listEl = document.getElementById("settings-history-list");
  listEl.classList.remove("hidden");
  listEl.innerHTML = '<div class="edit-pending-row"><span>Lädt…</span></div>';

  let history;
  try {
    history = await api.getBackupHistory(session.token); // rohes Array [{id, createdAt}, ...]
  } catch (e) {
    listEl.innerHTML = '<div class="edit-pending-row"><span>Verlauf konnte nicht geladen werden.</span></div>';
    return;
  }
  if (!Array.isArray(history) || history.length === 0) {
    listEl.innerHTML = '<div class="edit-pending-row"><span>Kein Verlauf vorhanden.</span></div>';
    return;
  }

  listEl.innerHTML = history
    .map(
      (v) =>
        `<div class="edit-pending-row clickable" data-id="${v.id}"><span>${new Date(v.createdAt).toLocaleString("de-DE")}</span></div>`
    )
    .join("");
  listEl.querySelectorAll(".edit-pending-row[data-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      const id = Number(row.dataset.id);
      if (
        !confirm(
          "Bestehende Fahrten mit übereinstimmender Start-/Endzeit werden auf diesen Stand " +
            "zurückgesetzt. Fahrten, die nur in dieser Version existieren, werden ergänzt. Nichts wird gelöscht."
        )
      ) {
        return;
      }
      try {
        const result = await api.getBackupVersion(session.token, id);
        const blob = { ciphertextBase64: result.ciphertext, ivBase64: result.iv };
        const json = await cryptoUtil.decryptWithDek(blob, dek);
        const { restored, added } = restoreFromJsonWeb(json);
        await pushBackupConflictSafe();
        alert(`${restored} Fahrt(en) zurückgesetzt${added > 0 ? `, ${added} ergänzt` : ""}.`);
        listEl.classList.add("hidden");
      } catch (e) {
        alert("Wiederherstellen fehlgeschlagen: " + (e.message || e));
      }
    });
  });
});

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderTab();
  });
});

// --- Auto-Auswahl ---
function renderCarSelector() {
  const select = document.getElementById("car-select");
  select.innerHTML = '<option value="">Alle Autos</option>';
  backupData.cars.forEach((car) => {
    const opt = document.createElement("option");
    opt.value = car.id;
    opt.textContent = car.name;
    select.appendChild(opt);
  });
  select.value = selectedCarId;
}
document.getElementById("car-select").addEventListener("change", (e) => {
  selectedCarId = e.target.value;
  renderTab();
});

// --- Fahrten filtern ---
function filteredTrips() {
  if (!selectedCarId) return backupData.trips;
  return backupData.trips.filter((t) => String(t.carId) === String(selectedCarId));
}

function parseTripPoints(trip) {
  try {
    const arr = JSON.parse(trip.gpxTrackJson);
    return arr.map((p) => [p.lat, p.lon]);
  } catch (e) {
    return [];
  }
}

function parseTripPointsWithTime(trip) {
  try {
    const arr = JSON.parse(trip.gpxTrackJson);
    return arr.map((p) => ({ lat: p.lat, lon: p.lon, ts: p.ts }));
  } catch (e) {
    return [];
  }
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function segmentSpeedKmh(p1, p2) {
  const dtSeconds = (p2.ts - p1.ts) / 1000;
  if (dtSeconds <= 0) return 0;
  return (haversineMeters(p1, p2) / dtSeconds) * 3.6;
}

/**
 * Spiegelt Trip.toSpeedSeries() aus der Android-App: baut aus den rohen GPS-Punkten (lat, lon, ts)
 * eine Zeit/Geschwindigkeit/Distanz-Serie für den Graphen.
 */
function buildSpeedSeries(raw) {
  if (raw.length < 2) return [];
  const startTs = raw[0].ts;
  let cumulativeMeters = 0;
  return raw.map((p, i) => {
    let speedKmh;
    if (i === 0) {
      speedKmh = segmentSpeedKmh(raw[0], raw[1]);
    } else {
      cumulativeMeters += haversineMeters(raw[i - 1], p);
      speedKmh = segmentSpeedKmh(raw[i - 1], p);
    }
    return {
      offsetSeconds: (p.ts - startTs) / 1000,
      speedKmh,
      cumulativeKm: cumulativeMeters / 1000,
      timestamp: p.ts,
      lat: p.lat,
      lon: p.lon,
    };
  });
}

/**
 * Median-Filter über die Geschwindigkeit (Fenster von 9 Punkten): einzelne GPS-Ausreißer (kurzer
 * ungenauer Fix) erzeugen sonst isolierte Nadel-Spitzen statt eines realistisch wirkenden Verlaufs
 * - der Median eines Fensters ignoriert genau solche einzelnen Ausreißer, echte Beschleunigungs-/
 * Bremstrends bleiben erhalten. cumulativeKm/Position bleiben unverändert (die Distanz-Berechnung
 * selbst ist von dem Rauschen nicht betroffen, nur die Momentan-Geschwindigkeit pro Segment).
 * windowRadius=4 statt 2: GPS-Aussetzer (z.B. beim Einrasten des Fixes zu Fahrtbeginn oder in einer
 * Unterführung) liefern oft mehrere aufeinanderfolgende schlechte Punkte statt nur einem einzelnen
 * - ein 5-Punkte-Fenster reißt bei 3 aufeinanderfolgenden Ausreißern durch (der Ausreißer wird selbst
 * zum Median), ein 9-Punkte-Fenster hält das deutlich zuverlässiger ab (verifiziert per Test).
 */
function medianFilterSpeeds(points, windowRadius = 4) {
  const raw = points.map((p) => p.speedKmh);
  return points.map((p, i) => {
    const lo = Math.max(0, i - windowRadius);
    const hi = Math.min(raw.length - 1, i + windowRadius);
    const window = raw.slice(lo, hi + 1).sort((a, b) => a - b);
    return { ...p, speedKmh: window[Math.floor(window.length / 2)] };
  });
}

/** Rundet für eine lesbare Achsenbeschriftung auf ein "glattes" Vielfaches von 10 auf. */
function niceCeilSpeed(value) {
  return Math.max(10, Math.ceil(value / 10) * 10);
}

// Letzte Sicherheitsgrenze für die Anzeige, bewusst NICHT trip.maxSpeedKmh: dieser Wert kommt zwar
// normalerweise vom GPS-Chip direkt (Doppler-basiert, robuster als Positions-Differenzen), kann
// aber selbst durch genau dasselbe GPS-Problem verfälscht sein (z.B. beim Einrasten des Fixes zu
// Fahrtbeginn) - ein Clamp darauf würde dann einen verdächtig glatten Plateau exakt auf diesem
// (falschen) Wert erzeugen, statt das Problem sichtbar zu machen. 260 km/h ist für ein normales
// Auto ohnehin unrealistisch, greift also praktisch nie bei echten Daten, nur bei Sensor-Ausfällen,
// die selbst das breitere Median-Fenster nicht abfängt.
const PLAUSIBLE_MAX_CAR_KMH = 260;

/**
 * Gemeinsame Zeit/Geschwindigkeit/Distanz-Serie für eine Fahrt (median-gefiltert + gekappt), damit
 * der Geschwindigkeits-Graph und das Hover auf der Routen-Linie exakt dieselben Werte anzeigen.
 */
function getTripSpeedSeries(trip) {
  const rawPoints = buildSpeedSeries(parseTripPointsWithTime(trip));
  if (rawPoints.length < 2) return [];
  const filtered = medianFilterSpeeds(rawPoints);
  return filtered.map((p) =>
    p.speedKmh > PLAUSIBLE_MAX_CAR_KMH ? { ...p, speedKmh: PLAUSIBLE_MAX_CAR_KMH } : p
  );
}

// --- Labels & markierte Streckenabschnitte (seit v1.7.0 / App 0.8.0-0.11.0) ---
// JS-Port von data/TripGeoMath.kt (Trip.labelList()/labelIcon()/labelColor()/segmentStats()) -
// dieselbe Logik, damit Web und App optisch identisch anzeigen.
function labelList(trip) {
  return (trip.labels || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function labelIcon(label) {
  const lower = label.toLowerCase();
  if (lower.includes("fähre") || lower.includes("faehre")) return "⛴";
  if (lower.includes("pause")) return "☕";
  if (lower.includes("nacht")) return "🌙";
  return "🏷️";
}

/** Feste Signalfarbe je Markierungs-Typ, spiegelt labelColor() aus data/TripGeoMath.kt. */
function labelColor(label) {
  const lower = label.toLowerCase();
  if (lower.includes("fähre") || lower.includes("faehre")) return "#2979FF";
  if (lower.includes("pause")) return "#FFB300";
  if (lower.includes("nacht")) return "#7C4DFF";
  return "#26C6DA";
}

function parseSegmentMarks(trip) {
  try {
    const arr = JSON.parse(trip.segmentMarksJson || "[]");
    return arr.map((m) => ({ label: m.label, startTs: m.startTs, endTs: m.endTs }));
  } catch (e) {
    return [];
  }
}

function segmentMarksToJson(marks) {
  return JSON.stringify(marks.map((m) => ({ label: m.label, startTs: m.startTs, endTs: m.endTs })));
}

/**
 * Distanz/Dauer/Ø-/Höchstgeschwindigkeit NUR innerhalb eines markierten Abschnitts - unabhängig
 * von den Gesamt-Fahrt-Werten (die den Abschnitt weiterhin mit einschließen, siehe
 * recomputeMaxSpeedExcludingMarks()). Spiegelt Trip.segmentStats() aus TripGeoMath.kt.
 */
function computeSegmentStats(trip, mark) {
  const durationMinutes = Math.max(0, Math.round((mark.endTs - mark.startTs) / 60000));
  const raw = parseTripPointsWithTime(trip).filter((p) => p.ts >= mark.startTs && p.ts <= mark.endTs);
  if (raw.length < 2) return { distanceKm: 0, durationMinutes, avgSpeedKmh: 0, maxSpeedKmh: 0 };

  let distanceMeters = 0;
  let maxSpeedKmh = 0;
  for (let i = 1; i < raw.length; i++) {
    distanceMeters += haversineMeters(raw[i - 1], raw[i]);
    const speed = Math.min(segmentSpeedKmh(raw[i - 1], raw[i]), PLAUSIBLE_MAX_CAR_KMH);
    if (speed > maxSpeedKmh) maxSpeedKmh = speed;
  }
  const avgSpeedKmh = durationMinutes > 0 ? (distanceMeters / 1000) / (durationMinutes / 60) : 0;
  return { distanceKm: distanceMeters / 1000, durationMinutes, avgSpeedKmh, maxSpeedKmh };
}

/**
 * Höchstgeschwindigkeit der GESAMTEN Fahrt neu berechnet, wobei Segmente innerhalb eines
 * markierten Abschnitts (z.B. Fähre) ausgeschlossen werden - spiegelt
 * recomputeMaxSpeedExcludingMarks() aus TripGeoMath.kt. Distanz/Dauer/Ø-Geschwindigkeit der Fahrt
 * bleiben davon unberührt.
 */
function recomputeMaxSpeedExcludingMarks(trip, marks) {
  const raw = parseTripPointsWithTime(trip);
  if (raw.length < 2) return trip.maxSpeedKmh;
  const inAnyMark = (ts) => marks.some((m) => ts >= m.startTs && ts <= m.endTs);
  let max = 0;
  for (let i = 1; i < raw.length; i++) {
    if (inAnyMark(raw[i - 1].ts) || inAnyMark(raw[i].ts)) continue;
    const speed = Math.min(segmentSpeedKmh(raw[i - 1], raw[i]), PLAUSIBLE_MAX_CAR_KMH);
    if (speed > max) max = speed;
  }
  return max;
}

function renderLabelBadges(trip) {
  const labels = labelList(trip);
  const infoEl = document.getElementById("trip-detail-info");
  const existing = infoEl.querySelector(".trip-label-badges");
  if (existing) existing.remove();
  if (labels.length === 0) return;

  const row = document.createElement("div");
  row.className = "trip-label-badges";
  row.innerHTML = labels
    .map(
      (label) =>
        `<span class="trip-label-badge"><span class="dot" style="background:${labelColor(label)}"></span>${labelIcon(label)} ${escapeHtml(label)}</span>`
    )
    .join("");
  infoEl.querySelector(".date").insertAdjacentElement("afterend", row);
}

function renderSegmentList(trip) {
  const container = document.getElementById("trip-detail-segments");
  const marks = parseSegmentMarks(trip);
  if (marks.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.classList.remove("hidden");
  container.innerHTML =
    '<div class="segment-list-header">Markierte Abschnitte</div>' +
    marks
      .map((mark) => {
        const stats = computeSegmentStats(trip, mark);
        const startTime = new Date(mark.startTs).toLocaleTimeString("de-DE");
        const endTime = new Date(mark.endTs).toLocaleTimeString("de-DE");
        return `
          <div class="segment-row">
            <span class="segment-color-dot" style="background:${labelColor(mark.label)}"></span>
            <div class="segment-row-text">
              <div class="title">${labelIcon(mark.label)} ${escapeHtml(mark.label)}: ${startTime}–${endTime}</div>
              <div class="stats">${stats.distanceKm.toFixed(1)} km · ${formatTripDuration(stats.durationMinutes)} · Ø ${Math.round(stats.avgSpeedKmh)} km/h · Max ${Math.round(stats.maxSpeedKmh)} km/h</div>
            </div>
          </div>
        `;
      })
      .join("");
}

/** Baut je markiertem Abschnitt eine gestrichelte Polyline in fester Signalfarbe (labelColor()). */
function renderSegmentMarkLines(trip) {
  const marks = parseSegmentMarks(trip);
  if (marks.length === 0) return;
  const raw = parseTripPointsWithTime(trip);
  if (raw.length < 2) return;

  marks.forEach((mark) => {
    const inRange = raw.filter((p) => p.ts >= mark.startTs && p.ts <= mark.endTs).map((p) => [p.lat, p.lon]);
    if (inRange.length < 2) return;
    const line = L.polyline(inRange, {
      color: labelColor(mark.label),
      weight: 6,
      dashArray: "10, 8",
    }).addTo(detailMap);
    routeLineLayers.push(line);
  });
}

// --- Rendering ---
function renderTab() {
  const trips = filteredTrips();
  const entries = buildTripListEntries(trips, backupData.groups || []);

  if (currentTab === "home") {
    document.getElementById("stats-panel").classList.remove("hidden");
    renderStats(trips);
    renderTripList(entries.slice(0, 5));
  } else {
    document.getElementById("stats-panel").classList.add("hidden");
    renderTripList(entries);
  }
  renderMainMap(trips);
}

// --- Fahrten gruppieren (seit v1.9.0) - JS-Port von data/TripGrouping.kt der App ---

/**
 * Baut aus der flachen Fahrten-/Gruppen-Liste die gemischten Einträge für die Fahrtenliste:
 * gruppierte Fahrten erscheinen als EIN zusammengefasster Eintrag statt einzeln, ungruppierte
 * Fahrten unverändert einzeln. Sortiert nach der jeweils neuesten Fahrt absteigend (eine Gruppe
 * "zählt" wie ihre neueste Mitgliedsfahrt). Leere Gruppen (letzte Fahrt entfernt) werden hier
 * herausgefiltert, aber NICHT automatisch gelöscht - spiegelt buildTripListEntries() 1:1.
 */
function buildTripListEntries(trips, groups) {
  const tripsByGroupId = new Map();
  const ungrouped = [];
  trips.forEach((t) => {
    if (t.groupId != null) {
      if (!tripsByGroupId.has(t.groupId)) tripsByGroupId.set(t.groupId, []);
      tripsByGroupId.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  });

  const groupEntries = groups
    .map((g) => {
      const groupTrips = tripsByGroupId.get(g.id);
      if (!groupTrips || groupTrips.length === 0) return null;
      const sorted = [...groupTrips].sort((a, b) => b.startTimestamp - a.startTimestamp);
      return { type: "group", group: g, trips: sorted, sortTimestamp: sorted[0].startTimestamp };
    })
    .filter(Boolean);

  const singleEntries = ungrouped.map((t) => ({ type: "trip", trip: t, sortTimestamp: t.startTimestamp }));

  return [...groupEntries, ...singleEntries].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
}

/**
 * Gesamt-Statistik über mehrere Fahrten (für eine Gruppe) - spiegelt List<Trip>.groupStats() aus
 * data/TripGrouping.kt: Summe km, Summe Fahrzeit (Gesamtdauer MINUS pausedMinutes je Fahrt - anders
 * als renderStats() oben, das noch nicht auf pausedMinutes umgestellt ist), einfacher Durchschnitt
 * der Einzel-Ø-Geschwindigkeiten, Max der Einzel-Höchstgeschwindigkeiten.
 */
function computeGroupStats(trips) {
  const totalKm = trips.reduce((sum, t) => sum + t.distanceMeters, 0) / 1000;
  const tripCount = trips.length;
  // tripDrivingMinutes() ist weiter unten definiert (Funktionsdeklaration, daher hier bereits nutzbar).
  const totalDrivingMinutes = trips.reduce((sum, t) => sum + tripDrivingMinutes(t), 0);
  const avgSpeedKmh = trips.length ? trips.reduce((sum, t) => sum + t.avgSpeedKmh, 0) / trips.length : 0;
  const maxSpeedKmh = trips.length ? Math.max(...trips.map((t) => t.maxSpeedKmh)) : 0;
  return { totalKm, tripCount, totalDrivingMinutes, avgSpeedKmh, maxSpeedKmh };
}

function renderStats(trips) {
  const totalKm = trips.reduce((sum, t) => sum + t.distanceMeters, 0) / 1000;
  const totalMinutes = trips.reduce(
    (sum, t) => sum + (t.endTimestamp - t.startTimestamp) / 60000, 0
  );
  const avgSpeed = trips.length
    ? trips.reduce((sum, t) => sum + t.avgSpeedKmh, 0) / trips.length
    : 0;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  document.getElementById("stats-panel").innerHTML = `
    <div class="stat-tile"><div class="value">${totalKm.toFixed(0)} km</div><div class="label">Gesamt</div></div>
    <div class="stat-tile"><div class="value">${trips.length}</div><div class="label">Fahrten</div></div>
    <div class="stat-tile"><div class="value">${durationText}</div><div class="label">Fahrzeit</div></div>
    <div class="stat-tile"><div class="value">${avgSpeed.toFixed(0)} km/h</div><div class="label">Ø Speed</div></div>
  `;
}

function renderTripList(entries) {
  const list = document.getElementById("trip-list");
  list.innerHTML = "";

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-hint">Noch keine Fahrten vorhanden.</div>';
    return;
  }

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "trip-row";

    const canvas = document.createElement("canvas");
    canvas.width = 56;
    canvas.height = 56;

    const text = document.createElement("div");
    text.className = "trip-row-text";

    if (entry.type === "group") {
      const stats = computeGroupStats(entry.trips);
      drawGroupRouteThumbnail(canvas, entry.trips.map(parseTripPoints));
      text.innerHTML = `
        <div class="name">${escapeHtml(entry.group.name)}</div>
        <div class="meta"><span>${stats.totalKm.toFixed(1)} km</span><span>${stats.tripCount} Fahrten</span></div>
        <div class="trip-row-group-badge">📁 Gruppe</div>
      `;
      row.appendChild(text);
      row.appendChild(canvas);
      row.addEventListener("click", () => openTripGroup(entry.group));
    } else {
      const trip = entry.trip;
      const durationMin = Math.round((trip.endTimestamp - trip.startTimestamp) / 60000);
      const km = (trip.distanceMeters / 1000).toFixed(1);
      drawRouteThumbnail(canvas, parseTripPoints(trip));
      text.innerHTML = `
        <div class="name">${escapeHtml(trip.name)}</div>
        <div class="meta"><span>${km} km</span><span>${formatTripDuration(durationMin)}</span></div>
      `;
      row.appendChild(text);
      row.appendChild(canvas);
      row.addEventListener("click", () => openTripDetail(trip));
    }

    list.appendChild(row);
  });
}

/**
 * Wie drawRouteThumbnail(), aber über die kombinierten Routen mehrerer Fahrten - jede Fahrt bekommt
 * einen eigenen, unverbundenen Pfad (kein moveTo/lineTo über mehrere Fahrten hinweg), sonst würde
 * eine gerade "Teleport"-Linie zwischen dem Ziel der einen und dem Start der nächsten Fahrt
 * gezeichnet. Spiegelt MapThumbnailGenerator.renderThumbnail() (mehrere Punktlisten) der App.
 */
function drawGroupRouteThumbnail(canvas, tripsPointLists, pad = 6) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#241f19";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let any = false;
  tripsPointLists.forEach((points) => {
    points.forEach(([lat, lon]) => {
      any = true;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    });
  });
  if (!any) return;

  const latRange = Math.max(maxLat - minLat, 0.00001);
  const lonRange = Math.max(maxLon - minLon, 0.00001);
  const scale = Math.min((canvas.width - pad * 2) / lonRange, (canvas.height - pad * 2) / latRange);
  const drawnW = lonRange * scale, drawnH = latRange * scale;
  const offX = (canvas.width - drawnW) / 2;
  const offY = (canvas.height - drawnH) / 2;

  ctx.strokeStyle = "#ff7a1a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  tripsPointLists.forEach((points) => {
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach(([lat, lon], i) => {
      const x = offX + (lon - minLon) * scale;
      const y = offY + (maxLat - lat) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function drawRouteThumbnail(canvas, points) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#241f19";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (points.length < 2) return;

  // Kein Math.min(...array)/Math.max(...array) hier: bei Fahrten mit vielen tausend GPS-Punkten
  // (ganztägige Fahrten) sprengt das den JS-Aufrufstack (RangeError) und die Funktion bricht ab,
  // bevor irgendwas gezeichnet wird - dieselbe Größenordnung an Punkten, die schon in der Android-App
  // die SQLiteBlobTooBigException verursacht hat (siehe CLAUDE.md).
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  points.forEach(([lat, lon]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });
  const latRange = Math.max(maxLat - minLat, 0.00001);
  const lonRange = Math.max(maxLon - minLon, 0.00001);
  const pad = 6;
  const scale = Math.min((canvas.width - pad * 2) / lonRange, (canvas.height - pad * 2) / latRange);
  const drawnW = lonRange * scale, drawnH = latRange * scale;
  const offX = (canvas.width - drawnW) / 2;
  const offY = (canvas.height - drawnH) / 2;

  ctx.strokeStyle = "#ff7a1a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach(([lat, lon], i) => {
    const x = offX + (lon - minLon) * scale;
    const y = offY + (maxLat - lat) * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Spiegelt Trip.durationFormatted (Trip.kt) 1:1: über 60min als "Xh Ym", sonst "X min"
function formatTripDuration(minutes) {
  if (minutes > 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return `${minutes} min`;
}

// --- Hauptkarte (immer alle gefilterten Fahrten, außer in der Detail-Ansicht) ---
function ensureMainMap() {
  if (mainMap) return;
  mainMap = L.map("map", { zoomControl: true }).setView([47.8, 11.7], 12);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(mainMap);
}

function renderMainMap(trips) {
  ensureMainMap();
  mainMap.invalidateSize();
  mainMapLayers.forEach((l) => mainMap.removeLayer(l));
  mainMapLayers = [];

  const allPoints = [];
  trips.forEach((trip) => {
    const points = parseTripPoints(trip);
    if (points.length < 2) return;
    const line = L.polyline(points, { color: "#ff7a1a", weight: 4, opacity: 0.85 }).addTo(mainMap);
    mainMapLayers.push(line);
    // kein allPoints.push(...points) - gleiches Stack-Limit-Problem wie bei Math.max(...array)
    // oben, bei vielen tausend Punkten (lange Fahrten) über mehrere Trips hinweg gesammelt
    points.forEach((p) => allPoints.push(p));
  });

  if (allPoints.length > 0) {
    mainMap.fitBounds(allPoints, { padding: [30, 30] });
  }
}

// --- Fahrt-Detail ---
// Obergrenze für Geschwindigkeits-Segmente auf der Route: bei sehr langen Fahrten (viele tausend
// GPS-Punkte) würde ein Leaflet-Layer pro Segment das Rendering spürbar verlangsamen - deshalb wird
// bei Bedarf heruntergesampelt (siehe renderRouteLine()).
const MAX_ROUTE_COLOR_SEGMENTS = 1500;

// Feste, einheitliche Geschwindigkeits-Farbskala (bewusst NICHT relativ zur einzelnen Fahrt) -
// dieselbe Farbe bedeutet dadurch bei jeder Fahrt dieselbe Geschwindigkeit, vergleichbar zwischen
// z.B. einer Stadtfahrt und einer Autobahnfahrt. Zweistufig: 0-130 km/h grün->rot (130 = Richt-
// geschwindigkeit Autobahn), 130-180 km/h zusätzlich rot->lila zur klaren Abhebung sehr hoher
// Geschwindigkeiten. Alles über 180 km/h wird auf volles Lila gekappt.
const ROUTE_COLOR_RED_KMH = 130;
const ROUTE_COLOR_PURPLE_KMH = 180;

/** Grün (langsam) -> Rot (130 km/h) -> Lila (ab 180 km/h) auf der festen Skala. */
function speedToColor(speedKmh) {
  let hue;
  if (speedKmh <= ROUTE_COLOR_RED_KMH) {
    const fraction = Math.min(1, Math.max(0, speedKmh / ROUTE_COLOR_RED_KMH));
    hue = 120 * (1 - fraction); // 120 (grün) .. 0 (rot)
  } else {
    const fraction = Math.min(1, Math.max(0, (speedKmh - ROUTE_COLOR_RED_KMH) / (ROUTE_COLOR_PURPLE_KMH - ROUTE_COLOR_RED_KMH)));
    hue = 360 - 75 * fraction; // 360/0 (rot) .. 285 (lila), kurzer Weg (nicht zurück durch Gelb/Grün)
  }
  return `hsl(${hue}, 85%, 50%)`;
}

/**
 * Zeichnet die Routen-Linie(n) auf der Detail-Karte neu, je nach gewähltem Anzeigemodus
 * (Standard-Farbe oder nach Geschwindigkeit eingefärbt). Entfernt vorher die zuvor gezeichnete(n)
 * Linie(n), lässt Start-/Ziel-Marker und den Graph-Scrub-Marker aber unangetastet.
 */
function renderRouteLine(trip, points) {
  routeLineLayers.forEach((l) => detailMap.removeLayer(l));
  routeLineLayers = [];

  const mode = document.getElementById("route-color-mode").value;
  let hoverLine;

  if (mode === "speed") {
    const series = getTripSpeedSeries(trip);
    if (series.length >= 2) {
      const step = Math.max(1, Math.ceil((series.length - 1) / MAX_ROUTE_COLOR_SEGMENTS));
      let i = 0;
      while (i < series.length - 1) {
        const end = Math.min(i + step, series.length - 1);
        const segPoints = [];
        let speedSum = 0;
        for (let j = i; j <= end; j++) {
          segPoints.push([series[j].lat, series[j].lon]);
          speedSum += series[j].speedKmh;
        }
        const avgSpeed = speedSum / (end - i + 1);
        const segment = L.polyline(segPoints, { color: speedToColor(avgSpeed), weight: 5 }).addTo(detailMap);
        routeLineLayers.push(segment);
        i = end;
      }
    }
    // Unsichtbare, breitere Linie über die vollen (nicht heruntergesampelten) Punkte - dient nur
    // dem zuverlässigen Hover/Tap, unabhängig vom Anzeigemodus dieselbe Interaktion.
    hoverLine = L.polyline(points, { opacity: 0, weight: 16 }).addTo(detailMap);
  } else {
    hoverLine = L.polyline(points, { color: "#ff7a1a", weight: 5 }).addTo(detailMap);
  }

  routeLineLayers.push(hoverLine);
  setupRouteHover(hoverLine, trip);
  renderSegmentMarkLines(trip);
}

/**
 * Bindet ein Tooltip an die Routen-Linie auf der Detail-Karte: beim Hovern (Maus) bzw.
 * Antippen (Touch, via Leaflet automatisch) zeigt es Uhrzeit/km-Stand/Geschwindigkeit des
 * nächstgelegenen Punkts - dieselbe Serie wie der Geschwindigkeits-Graph darunter.
 */
function setupRouteHover(line, trip) {
  const series = getTripSpeedSeries(trip);
  if (series.length < 2) return;

  line.bindTooltip("", {
    sticky: true,
    direction: "top",
    offset: [0, -8],
    opacity: 0.95,
    className: "route-hover-tooltip",
  });

  line.on("mousemove", (e) => {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const d = haversineMeters({ lat: e.latlng.lat, lon: e.latlng.lng }, series[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    const p = series[bestIndex];
    const time = new Date(p.timestamp).toLocaleTimeString("de-DE");
    line.setTooltipContent(
      `<div class="route-hover-time">🕐 ${time}</div>` +
      `<div class="route-hover-stats"><span>📍 ${p.cumulativeKm.toFixed(2)} km</span><span>⚡ ${Math.round(p.speedKmh)} km/h</span></div>`
    );
  });
}

function openTripDetail(trip) {
  const dateStr = new Date(trip.startTimestamp).toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const startTime = new Date(trip.startTimestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const endTime = new Date(trip.endTimestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const durationMin = Math.round((trip.endTimestamp - trip.startTimestamp) / 60000);
  const car = backupData.cars.find((c) => c.id === trip.carId);

  document.getElementById("trip-detail-info").innerHTML = `
    <h2>${escapeHtml(trip.name)}</h2>
    <div class="date">${dateStr} · ${startTime} – ${endTime} Uhr ${car ? "· " + escapeHtml(car.name) : ""}</div>
    <div class="detail-stats">
      <div class="stat-tile"><div class="value">${(trip.distanceMeters / 1000).toFixed(2)} km</div><div class="label">Distanz</div></div>
      <div class="stat-tile"><div class="value">${formatTripDuration(durationMin)}</div><div class="label">Dauer</div></div>
      <div class="stat-tile"><div class="value">${trip.avgSpeedKmh.toFixed(0)} km/h</div><div class="label">Ø Geschwindigkeit</div></div>
      <div class="stat-tile"><div class="value">${trip.maxSpeedKmh.toFixed(0)} km/h</div><div class="label">Max. Geschwindigkeit</div></div>
    </div>
  `;

  renderLabelBadges(trip);
  renderSegmentList(trip);
  document.getElementById("trip-detail-edit").classList.remove("hidden");

  showScreen("detail");
  applyGraphCollapsedState();
  applyRouteColorModeSelection();
  currentDetailTrip = trip;

  // Karte erst nach dem Sichtbarwerden initialisieren (Leaflet braucht sichtbare Größe)
  setTimeout(() => {
    if (!detailMap) {
      detailMap = L.map("trip-detail-map", { zoomControl: true, preferCanvas: true });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }).addTo(detailMap);
    } else {
      detailMap.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) detailMap.removeLayer(layer);
      });
      graphScrubMarker = null; // wurde durch die Zeile oben mit entfernt, Referenz nicht mehr gültig
      routeLineLayers = []; // dito - die Referenzen zeigen jetzt auf bereits entfernte Layer
    }

    const points = parseTripPoints(trip);
    if (points.length >= 2) {
      renderRouteLine(trip, points);
      L.circleMarker(points[0], { radius: 7, color: "#fff", fillColor: "#43a047", fillOpacity: 1, weight: 2 }).addTo(detailMap);
      L.circleMarker(points[points.length - 1], { radius: 7, color: "#fff", fillColor: "#212121", fillOpacity: 1, weight: 2 }).addTo(detailMap);
      detailMap.fitBounds(points, { padding: [30, 30] });
    }
    detailMap.invalidateSize();

    renderSpeedGraph(trip);
  }, 50);
}

/**
 * Zeichnet den Geschwindigkeits-Graphen für die aktuell geöffnete Fahrt und richtet Ziehen/Tippen
 * zum Scrubben ein (Uhrzeit/km-Stand/Speed an der gewählten Stelle, Marker wandert auf detailMap mit).
 * Spiegelt SpeedGraph() aus TripDetailScreen.kt der Android-App.
 */
function renderSpeedGraph(trip) {
  const canvas = document.getElementById("speed-graph-canvas");
  const chip = document.getElementById("graph-info-chip");
  const emptyHint = document.getElementById("graph-empty-hint");
  const ctx = canvas.getContext("2d");

  const points = getTripSpeedSeries(trip);
  if (points.length < 2) {
    canvas.classList.add("hidden");
    chip.classList.add("hidden");
    emptyHint.classList.remove("hidden");
    currentGraphRedraw = null;
    return;
  }
  canvas.classList.remove("hidden");
  chip.classList.remove("hidden");
  emptyHint.classList.add("hidden");

  // Zusätzliche Sicherheitsgrenze: trip.maxSpeedKmh kommt vom GPS-Chip direkt (Doppler-basiert,
  // deutlich robuster als unsere eigene Positions-Differenz-Rechnung) und ist schon in den
  // Stat-Kacheln zu sehen. scaleMax rundet das für eine lesbare Achsenbeschriftung auf.
  const maxSpeed = Math.max(1, trip.maxSpeedKmh || 0);
  const scaleMax = niceCeilSpeed(maxSpeed);
  const totalDuration = Math.max(1, points[points.length - 1].offsetSeconds);
  // Standardmäßig das Ende der Fahrt ausgewählt, wie in der App - von dort aus nach links ziehen
  let selectedIndex = points.length - 1;
  const leftGutter = 34; // Platz links für die Achsenbeschriftung (km/h)

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function updateChip() {
    const p = points[selectedIndex];
    const time = new Date(p.timestamp).toLocaleTimeString("de-DE");
    chip.innerHTML =
      `<span>🕐 ${time}</span>` +
      `<span>📍 ${p.cumulativeKm.toFixed(2)} km</span>` +
      `<span>⚡ ${Math.round(p.speedKmh)} km/h</span>`;
  }

  function updateMapMarker() {
    if (!detailMap) return;
    const p = points[selectedIndex];
    if (!graphScrubMarker) {
      graphScrubMarker = L.circleMarker([p.lat, p.lon], {
        radius: 8, color: "#fff", weight: 2, fillColor: "#ff7a1a", fillOpacity: 1,
      }).addTo(detailMap);
    } else {
      graphScrubMarker.setLatLng([p.lat, p.lon]);
    }
  }

  function draw() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    const plotW = Math.max(1, w - leftGutter);

    // Gitterlinien + Achsenbeschriftung (0 / 1/3 / 2/3 / voll), damit sich die Skala ablesen lässt
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    [0, 1 / 3, 2 / 3, 1].forEach((frac) => {
      const y = h - frac * h;
      const value = Math.round(scaleMax * frac);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftGutter, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(237, 224, 212, 0.55)";
      ctx.fillText(`${value}`, leftGutter - 6, Math.min(h - 6, Math.max(7, y)));
    });

    ctx.strokeStyle = "#ff7a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = leftGutter + (p.offsetSeconds / totalDuration) * plotW;
      const y = h - Math.min(1, p.speedKmh / scaleMax) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const sel = points[selectedIndex];
    const selX = leftGutter + (sel.offsetSeconds / totalDuration) * plotW;
    const selY = h - Math.min(1, sel.speedKmh / scaleMax) * h;

    ctx.save();
    ctx.strokeStyle = "rgba(237, 224, 212, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(selX, 0);
    ctx.lineTo(selX, h);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff7a1a";
    ctx.stroke();
  }

  function selectAtClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - leftGutter);
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left - leftGutter) / plotW));
    selectedIndex = Math.min(points.length - 1, Math.max(0, Math.round(fraction * (points.length - 1))));
    updateChip();
    updateMapMarker();
    draw();
  }

  let dragging = false;
  canvas.onpointerdown = (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    selectAtClientX(e.clientX);
  };
  canvas.onpointermove = (e) => {
    // Maus: Cursor folgt der Position schon beim reinen Hovern (kein Klick nötig).
    // Touch/Pen: nur während des Ziehens, da es dort kein Hover ohne Kontakt gibt.
    if (dragging || e.pointerType === "mouse") {
      selectAtClientX(e.clientX);
    }
  };
  canvas.onpointerup = () => { dragging = false; };
  canvas.onpointercancel = () => { dragging = false; };

  currentGraphRedraw = () => { resizeCanvas(); draw(); };
  resizeCanvas();
  updateChip();
  updateMapMarker();
  draw();
}

// Ein einziger globaler Resize-Handler statt pro Fahrt-Öffnung einen neuen anzuhängen (kein Leak)
window.addEventListener("resize", () => { if (currentGraphRedraw) currentGraphRedraw(); });

document.getElementById("trip-detail-back").addEventListener("click", () => {
  showScreen("main");
  currentDetailTrip = null;
  setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
});

// --- Fahrten gruppieren: Detailseite + Vollbild-Karte (seit v1.9.0) ---
// 1:1-Port von TripGroupDetailScreen.kt/TripGroupRouteScreen.kt/GroupRouteMap.kt der App.

/** Spiegelt Trip.drivingDurationMinutes (Trip.kt): Gesamtdauer minus pausedMinutes. */
function tripDrivingMinutes(trip) {
  return (trip.endTimestamp - trip.startTimestamp) / 60000 - (trip.pausedMinutes || 0);
}

/**
 * Kombinierte Geschwindigkeits-/Distanz-Serie über mehrere Fahrten - spiegelt buildGroupSpeedSeries()
 * aus data/TripGeoMath.kt der App 1:1: Fahrten chronologisch aneinandergereiht, offsetSeconds/
 * cumulativeKm laufen durchgehend weiter (keine echte Kalenderzeit-Lücke zwischen den Fahrten im
 * Graphen), die Geschwindigkeit wird aber NIE über die Nahtstelle zwischen zwei Fahrten hinweg
 * berechnet - jede Fahrt läuft durch buildSpeedSeries() als eigene, isolierte Punktreihe, sonst
 * würde die Luftlinien-"Geschwindigkeit" zwischen dem Ziel einer Fahrt und dem Start der nächsten
 * als astronomischer Ausreißer im Graphen erscheinen.
 */
function buildGroupSpeedSeries(trips) {
  let offsetBase = 0;
  let cumulativeBase = 0;
  const result = [];

  [...trips].sort((a, b) => a.startTimestamp - b.startTimestamp).forEach((trip) => {
    const raw = buildSpeedSeries(parseTripPointsWithTime(trip));
    if (raw.length < 2) return;

    raw.forEach((p) => {
      result.push({ ...p, offsetSeconds: offsetBase + p.offsetSeconds, cumulativeKm: cumulativeBase + p.cumulativeKm });
    });

    offsetBase += raw[raw.length - 1].offsetSeconds;
    cumulativeBase += raw[raw.length - 1].cumulativeKm;
  });
  return result;
}

/** Wie getTripSpeedSeries(), nur für die kombinierte Serie mehrerer Fahrten. */
function getGroupSpeedSeries(trips) {
  const rawPoints = buildGroupSpeedSeries(trips);
  if (rawPoints.length < 2) return [];
  const filtered = medianFilterSpeeds(rawPoints);
  return filtered.map((p) =>
    p.speedKmh > PLAUSIBLE_MAX_CAR_KMH ? { ...p, speedKmh: PLAUSIBLE_MAX_CAR_KMH } : p
  );
}

/**
 * Zeichnet die Routen-Linien ALLER Mitgliedsfahrten auf groupMap neu - Standard-Farbe (eine Linie je
 * Fahrt) oder nach Geschwindigkeit eingefärbt. Für die Geschwindigkeitsfarbe zählt JE FAHRT deren
 * eigene getTripSpeedSeries() (nicht die kombinierte Gruppen-Serie) - für die Kartenfarbe zählt nur
 * die tatsächliche Geschwindigkeit an jedem Punkt, die Nahtstellen-Problematik betrifft nur den Graphen.
 */
function renderGroupRouteLine(trips) {
  groupRouteLineLayers.forEach((l) => groupMap.removeLayer(l));
  groupRouteLineLayers = [];

  const mode = document.getElementById("group-route-color-mode").value;

  trips.forEach((trip) => {
    const points = parseTripPoints(trip);
    if (points.length < 2) return;

    if (mode === "speed") {
      const series = getTripSpeedSeries(trip);
      if (series.length >= 2) {
        const step = Math.max(1, Math.ceil((series.length - 1) / MAX_ROUTE_COLOR_SEGMENTS));
        let i = 0;
        while (i < series.length - 1) {
          const end = Math.min(i + step, series.length - 1);
          const segPoints = [];
          let speedSum = 0;
          for (let j = i; j <= end; j++) {
            segPoints.push([series[j].lat, series[j].lon]);
            speedSum += series[j].speedKmh;
          }
          const avgSpeed = speedSum / (end - i + 1);
          const segment = L.polyline(segPoints, { color: speedToColor(avgSpeed), weight: 5 }).addTo(groupMap);
          groupRouteLineLayers.push(segment);
          i = end;
        }
      }
    } else {
      const line = L.polyline(points, { color: "#ff7a1a", weight: 5, opacity: 0.9 }).addTo(groupMap);
      groupRouteLineLayers.push(line);
    }
  });
}

/**
 * Kombinierter Geschwindigkeits-Graph über alle Mitgliedsfahrten - eigenständiger Klon von
 * renderSpeedGraph() (bewusst NICHT wiederverwendet, das ist fest an detailMap/#speed-graph-canvas
 * gebunden, spiegelt dasselbe Vorgehen wie renderEditGraph() für den Bearbeiten-Screen), gebunden an
 * groupMap/#group-graph-canvas.
 */
function renderGroupSpeedGraph(trips) {
  const canvas = document.getElementById("group-graph-canvas");
  const chip = document.getElementById("group-graph-info-chip");
  const emptyHint = document.getElementById("group-graph-empty-hint");
  const ctx = canvas.getContext("2d");

  const points = getGroupSpeedSeries(trips);
  if (points.length < 2) {
    canvas.classList.add("hidden");
    chip.classList.add("hidden");
    emptyHint.classList.remove("hidden");
    currentGroupGraphRedraw = null;
    return;
  }
  canvas.classList.remove("hidden");
  chip.classList.remove("hidden");
  emptyHint.classList.add("hidden");

  const maxSpeed = Math.max(1, trips.length ? Math.max(...trips.map((t) => t.maxSpeedKmh || 0)) : 0);
  const scaleMax = niceCeilSpeed(maxSpeed);
  const totalDuration = Math.max(1, points[points.length - 1].offsetSeconds);
  let selectedIndex = points.length - 1;
  const leftGutter = 34;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function updateChip() {
    const p = points[selectedIndex];
    const time = new Date(p.timestamp).toLocaleTimeString("de-DE");
    chip.innerHTML =
      `<span>🕐 ${time}</span>` +
      `<span>📍 ${p.cumulativeKm.toFixed(2)} km</span>` +
      `<span>⚡ ${Math.round(p.speedKmh)} km/h</span>`;
  }

  function updateMapMarker() {
    if (!groupMap) return;
    const p = points[selectedIndex];
    if (!groupGraphScrubMarker) {
      groupGraphScrubMarker = L.circleMarker([p.lat, p.lon], {
        radius: 8, color: "#fff", weight: 2, fillColor: "#ff7a1a", fillOpacity: 1,
      }).addTo(groupMap);
    } else {
      groupGraphScrubMarker.setLatLng([p.lat, p.lon]);
    }
  }

  function draw() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    const plotW = Math.max(1, w - leftGutter);

    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    [0, 1 / 3, 2 / 3, 1].forEach((frac) => {
      const y = h - frac * h;
      const value = Math.round(scaleMax * frac);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftGutter, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(237, 224, 212, 0.55)";
      ctx.fillText(`${value}`, leftGutter - 6, Math.min(h - 6, Math.max(7, y)));
    });

    ctx.strokeStyle = "#ff7a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = leftGutter + (p.offsetSeconds / totalDuration) * plotW;
      const y = h - Math.min(1, p.speedKmh / scaleMax) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const sel = points[selectedIndex];
    const selX = leftGutter + (sel.offsetSeconds / totalDuration) * plotW;
    const selY = h - Math.min(1, sel.speedKmh / scaleMax) * h;

    ctx.save();
    ctx.strokeStyle = "rgba(237, 224, 212, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(selX, 0);
    ctx.lineTo(selX, h);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff7a1a";
    ctx.stroke();
  }

  function selectAtClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - leftGutter);
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left - leftGutter) / plotW));
    selectedIndex = Math.min(points.length - 1, Math.max(0, Math.round(fraction * (points.length - 1))));
    updateChip();
    updateMapMarker();
    draw();
  }

  let dragging = false;
  canvas.onpointerdown = (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    selectAtClientX(e.clientX);
  };
  canvas.onpointermove = (e) => {
    if (dragging || e.pointerType === "mouse") {
      selectAtClientX(e.clientX);
    }
  };
  canvas.onpointerup = () => { dragging = false; };
  canvas.onpointercancel = () => { dragging = false; };

  currentGroupGraphRedraw = () => { resizeCanvas(); draw(); };
  resizeCanvas();
  updateChip();
  updateMapMarker();
  draw();
}
window.addEventListener("resize", () => { if (currentGroupGraphRedraw) currentGroupGraphRedraw(); });

/** Mitgliedsfahrten-Liste in der Gruppen-Detailseite - .trip-row wie überall, plus "✕"-Button zum
 * Entfernen aus der Gruppe (löscht die Fahrt selbst nicht, setzt nur groupId zurück). */
function renderGroupMembers(trips) {
  const container = document.getElementById("trip-group-members");
  container.innerHTML = "";

  if (trips.length === 0) {
    container.innerHTML = '<div class="empty-hint">Noch keine Fahrten in dieser Gruppe.</div>';
    return;
  }

  [...trips].sort((a, b) => b.startTimestamp - a.startTimestamp).forEach((trip) => {
    const row = document.createElement("div");
    row.className = "trip-row";

    const durationMin = Math.round((trip.endTimestamp - trip.startTimestamp) / 60000);
    const km = (trip.distanceMeters / 1000).toFixed(1);

    const canvas = document.createElement("canvas");
    canvas.width = 56;
    canvas.height = 56;
    drawRouteThumbnail(canvas, parseTripPoints(trip));

    const text = document.createElement("div");
    text.className = "trip-row-text";
    text.innerHTML = `
      <div class="name">${escapeHtml(trip.name)}</div>
      <div class="meta"><span>${km} km</span><span>${formatTripDuration(durationMin)}</span></div>
    `;

    const removeBtn = document.createElement("button");
    removeBtn.className = "trip-row-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Aus Gruppe entfernen";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(
        `„${trip.name}“ aus „${currentGroup.name}“ entfernen? Die Fahrt selbst bleibt erhalten und ` +
        `erscheint danach wieder einzeln in der Fahrtenliste.`
      )) return;
      replaceTripInBackupData(trip, { ...trip, groupId: null });
      try {
        await pushBackupConflictSafe();
      } catch (err) {
        alert("Speichern fehlgeschlagen: " + (err.message || err));
      }
      openTripGroup(currentGroup);
    });

    row.appendChild(text);
    row.appendChild(canvas);
    row.appendChild(removeBtn);
    row.addEventListener("click", () => openTripDetail(trip));
    container.appendChild(row);
  });
}

function applyGroupRouteColorModeSelection() {
  const mode = localStorage.getItem(ROUTE_COLOR_MODE_KEY) || "standard";
  document.getElementById("group-route-color-mode").value = mode;
  document.getElementById("group-route-color-legend").classList.toggle("hidden", mode !== "speed");
}
document.getElementById("group-route-color-mode").addEventListener("change", (e) => {
  localStorage.setItem(ROUTE_COLOR_MODE_KEY, e.target.value);
  document.getElementById("group-route-color-legend").classList.toggle("hidden", e.target.value !== "speed");
  if (currentGroupTrips && groupMap) {
    renderGroupRouteLine(currentGroupTrips);
  }
});

/**
 * Statische Vorschau-Kachel (kein Leaflet) in der Gruppen-Detailseite - spiegelt
 * GroupRouteMap(interactive=false) der App: reines Canvas-Thumbnail, kein Pan/Zoom, damit es nicht
 * mit dem Scrollen der Seite kollidiert. Größerer Rand (16px statt der 6px bei den kleinen
 * 56x56-Listen-Thumbnails) für die deutlich größere Kachel hier.
 */
function renderGroupThumbnailPreview(trips) {
  const canvas = document.getElementById("trip-group-thumb-canvas");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  drawGroupRouteThumbnail(canvas, trips.map(parseTripPoints), 16 * dpr);
}

function openTripGroup(group) {
  currentGroup = group;
  const trips = backupData.trips.filter((t) => t.groupId === group.id);
  currentGroupTrips = trips;

  document.getElementById("trip-group-title").textContent = group.name;
  const stats = computeGroupStats(trips);
  const hours = Math.floor(stats.totalDrivingMinutes / 60);
  const minutes = Math.round(stats.totalDrivingMinutes % 60);
  const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  document.getElementById("trip-group-stats").innerHTML = `
    <div class="stat-tile"><div class="value">${stats.totalKm.toFixed(0)} km</div><div class="label">Gesamt</div></div>
    <div class="stat-tile"><div class="value">${stats.tripCount}</div><div class="label">Fahrten</div></div>
    <div class="stat-tile"><div class="value">${durationText}</div><div class="label">Fahrzeit</div></div>
    <div class="stat-tile"><div class="value">${stats.avgSpeedKmh.toFixed(0)} km/h</div><div class="label">Ø Speed</div></div>
  `;

  renderGroupMembers(trips);

  showScreen("group");
  renderGroupThumbnailPreview(trips);
}

document.getElementById("trip-group-expand-btn").addEventListener("click", () => {
  if (currentGroup && currentGroupTrips) openTripGroupRoute(currentGroup, currentGroupTrips);
});

/**
 * Vollbild-Karte + kombinierter Geschwindigkeits-Graph über alle Mitgliedsfahrten, erreichbar über
 * das Vergrößerungs-Icon auf der statischen Vorschau in #trip-group-screen - spiegelt
 * TripGroupRouteScreen.kt der App (dort ebenfalls ein eigener Screen, nicht Teil der normalen
 * Gruppenansicht).
 */
function openTripGroupRoute(group, trips) {
  document.getElementById("trip-group-route-title").textContent = group.name;
  showScreen("groupRoute");
  applyGroupRouteColorModeSelection();

  // Karte erst nach dem Sichtbarwerden initialisieren (Leaflet braucht sichtbare Größe, siehe
  // openTripDetail()/CLAUDE.md-Stolperstein).
  setTimeout(() => {
    if (!groupMap) {
      groupMap = L.map("trip-group-map", { zoomControl: true, preferCanvas: true }).setView([47.8, 11.7], 12);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }).addTo(groupMap);
    } else {
      groupMap.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) groupMap.removeLayer(layer);
      });
      groupGraphScrubMarker = null;
      groupRouteLineLayers = [];
    }

    renderGroupRouteLine(trips);
    const allPoints = [];
    trips.forEach((t) => parseTripPoints(t).forEach((p) => allPoints.push(p)));
    if (allPoints.length > 0) groupMap.fitBounds(allPoints, { padding: [30, 30] });
    groupMap.invalidateSize();

    renderGroupSpeedGraph(trips);
  }, 50);
}

document.getElementById("trip-group-route-back").addEventListener("click", () => {
  showScreen("group");
});

document.getElementById("trip-group-back").addEventListener("click", () => {
  showScreen("main");
  currentGroup = null;
  currentGroupTrips = null;
  setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
});

document.getElementById("trip-group-rename-btn").addEventListener("click", async () => {
  if (!currentGroup) return;
  const newName = prompt("Neuer Name:", currentGroup.name);
  if (newName == null) return; // abgebrochen
  const trimmed = newName.trim();
  if (!trimmed || trimmed === currentGroup.name) return;
  const idx = backupData.groups.indexOf(currentGroup);
  if (idx === -1) return;
  backupData.groups[idx] = { ...currentGroup, name: trimmed };
  try {
    await pushBackupConflictSafe();
  } catch (e) {
    alert("Speichern fehlgeschlagen: " + (e.message || e));
  }
  openTripGroup(backupData.groups[idx]);
});

document.getElementById("group-delete-btn").addEventListener("click", async () => {
  if (!currentGroup) return;
  if (!confirm(
    `„${currentGroup.name}“ wird gelöscht. Die enthaltenen Fahrten bleiben erhalten und erscheinen ` +
    `danach wieder einzeln in der Fahrtenliste.`
  )) return;

  const groupId = currentGroup.id;
  backupData.trips
    .filter((t) => t.groupId === groupId)
    .forEach((t) => replaceTripInBackupData(t, { ...t, groupId: null }));
  backupData.groups = backupData.groups.filter((g) => g.id !== groupId);

  try {
    await pushBackupConflictSafe();
  } catch (e) {
    alert("Löschen fehlgeschlagen: " + (e.message || e));
  }
  currentGroup = null;
  showScreen("main");
  setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
});

document.getElementById("group-add-trips-btn").addEventListener("click", () => {
  if (!currentGroup) return;
  openGroupPicker(currentGroup.id);
});

// --- Fahrten gruppieren: Erstellen/Hinzufügen-Checkliste (seit v1.9.0) ---
// Spiegelt TripGroupPickerScreen.kt der App: targetGroupId == null -> Erstellen-Modus (Namensfeld +
// Checkliste aller Fahrten), sonst Hinzufügen-Modus (kein Namensfeld, Checkliste aller Fahrten, die
// noch NICHT in dieser Gruppe sind). Fahrten aus einer ANDEREN Gruppe zeigen ein Badge - eine Fahrt
// kann nur in einer Gruppe sein, Auswahl verschiebt sie dorthin statt es stillschweigend zu tun.
function openGroupPicker(targetGroupId) {
  groupPickerTargetId = targetGroupId;
  const isAddMode = targetGroupId != null;

  document.getElementById("trip-group-picker-title").textContent = isAddMode ? "Fahrten hinzufügen" : "Fahrten gruppieren";
  const nameInput = document.getElementById("trip-group-picker-name");
  nameInput.classList.toggle("hidden", isAddMode);
  nameInput.value = "";

  const confirmBtn = document.getElementById("trip-group-picker-confirm-btn");
  confirmBtn.textContent = isAddMode ? "Hinzufügen" : "Erstellen";
  confirmBtn.disabled = true;

  const candidateTrips = (isAddMode
    ? backupData.trips.filter((t) => t.groupId !== targetGroupId)
    : backupData.trips
  ).slice().sort((a, b) => b.startTimestamp - a.startTimestamp);

  const listEl = document.getElementById("trip-group-picker-list");
  listEl.innerHTML = "";

  function updatePickerConfirmState() {
    const anyChecked = Array.from(listEl.querySelectorAll("input[type=checkbox]")).some((c) => c.checked);
    confirmBtn.disabled = !anyChecked || (!isAddMode && nameInput.value.trim() === "");
  }
  nameInput.oninput = updatePickerConfirmState;

  if (candidateTrips.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">${isAddMode ? "Alle Fahrten sind bereits in dieser Gruppe." : "Keine Fahrten vorhanden."}</div>`;
  } else {
    candidateTrips.forEach((trip) => {
      const otherGroup = trip.groupId != null && trip.groupId !== targetGroupId
        ? backupData.groups.find((g) => g.id === trip.groupId)
        : null;

      const row = document.createElement("label");
      row.className = "edit-pending-row clickable picker-check-row";
      row._trip = trip;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", updatePickerConfirmState);

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = trip.name;

      row.appendChild(checkbox);
      row.appendChild(nameSpan);

      if (otherGroup) {
        const badge = document.createElement("span");
        badge.className = "picker-check-badge";
        badge.textContent = `Wechselt aus „${otherGroup.name}“`;
        row.appendChild(badge);
      }

      listEl.appendChild(row);
    });
  }

  showScreen("groupPicker");
}

document.getElementById("group-create-btn").addEventListener("click", () => openGroupPicker(null));

document.getElementById("trip-group-picker-back").addEventListener("click", () => {
  if (groupPickerTargetId != null) {
    const group = backupData.groups.find((g) => g.id === groupPickerTargetId);
    if (group) { showScreen("group"); openTripGroup(group); return; }
  }
  showScreen("main");
  setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
});

document.getElementById("trip-group-picker-confirm-btn").addEventListener("click", async () => {
  const listEl = document.getElementById("trip-group-picker-list");
  const selectedTrips = Array.from(listEl.children)
    .filter((row) => row._trip && row.querySelector("input[type=checkbox]")?.checked)
    .map((row) => row._trip);
  if (selectedTrips.length === 0) return;

  const btn = document.getElementById("trip-group-picker-confirm-btn");
  btn.disabled = true;
  try {
    if (groupPickerTargetId == null) {
      const name = document.getElementById("trip-group-picker-name").value.trim();
      if (!name) return;
      const newId = nextLocalId(backupData.groups);
      backupData.groups.push({ id: newId, name });
      selectedTrips.forEach((trip) => replaceTripInBackupData(trip, { ...trip, groupId: newId }));
    } else {
      selectedTrips.forEach((trip) => replaceTripInBackupData(trip, { ...trip, groupId: groupPickerTargetId }));
    }
    await pushBackupConflictSafe();

    if (groupPickerTargetId != null) {
      const group = backupData.groups.find((g) => g.id === groupPickerTargetId);
      if (group) { showScreen("group"); openTripGroup(group); }
    } else {
      showScreen("main");
      setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
    }
  } catch (e) {
    alert("Speichern fehlgeschlagen: " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
});

// --- Fahrt bearbeiten (seit v1.7.0) ---
// 1:1-Port von TripEditScreen.kt der Android-App: Zuschneiden (Anfang/Ende kürzen, Pause aus der
// Mitte entfernen - destruktiv, JS-Port von applyTripEditPlan()) und Markieren (Fahrt-Labels +
// Streckenabschnitte - nicht-destruktiv, lokaler Entwurf bis zum Verlassen der Seite). Bewusst
// native confirm()/prompt() statt eigener Modal-Komponenten (kein Modal-System in dieser App
// vorhanden, alert() wird an anderen Stellen bereits genutzt - siehe Registrieren/Passwort-Reset).
const LABEL_PRESETS = ["⛴ Fähre", "☕ Pause gemacht", "🌙 Nachtfahrt"];

let editTrip = null;
let editPendingLabels = [];
let editPendingMarks = [];
let editMarkA = null;
let editMarkB = null;
let editPendingActions = []; // { type: "trimStart"|"trimEnd"|"cut", ts|start/end, description }
let editMap = null;
let editMapLayers = [];
let editMapAMarker = null;
let editMapBMarker = null;
let editGraphState = null; // { points, scaleMax, totalDuration, startTs, selectedIndex }
let editGraphRedraw = null;

/**
 * JS-Port von applyTripEditPlan() aus data/TripGeoMath.kt: schneidet Anfang/Ende und/oder
 * Pausen-Bereiche aus den GPS-Punkten heraus, berechnet Distanz/Dauer/Geschwindigkeit neu. `trip`
 * muss bereits alle aktuellen (ggf. noch nicht gespeicherten) Labels/Markierungen tragen. Gibt
 * null zurück, wenn der Plan ungültig ist oder zu wenige Punkte übrig blieben.
 */
function applyTripEditPlanJs(trip, plan) {
  const raw = parseTripPointsWithTime(trip);
  if (raw.length < 2) return null;

  const newStartTs = plan.trimStartTs != null ? plan.trimStartTs : raw[0].ts;
  const newEndTs = plan.trimEndTs != null ? plan.trimEndTs : raw[raw.length - 1].ts;
  if (newStartTs >= newEndTs) return null;

  const excluded = (plan.pauseCuts || [])
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
    .map(([s, e]) => [Math.min(Math.max(s, newStartTs), newEndTs), Math.min(Math.max(e, newStartTs), newEndTs)])
    .filter(([s, e]) => s < e);

  const keptIndices = [];
  for (let i = 0; i < raw.length; i++) {
    const ts = raw[i].ts;
    if (ts < newStartTs || ts > newEndTs) continue;
    if (excluded.some(([s, e]) => ts >= s && ts <= e)) continue;
    keptIndices.push(i);
  }
  if (keptIndices.length < 2) return null;

  // Zusammenhängende Läufe (Original-Index-Nachbarschaft), damit Distanz nie über eine
  // Schnittlücke hinweg summiert wird (sonst Distanz-Artefakt durch "Teleport"-Strecke).
  const runs = [];
  keptIndices.forEach((idx) => {
    const lastRun = runs[runs.length - 1];
    if (lastRun && idx === lastRun[lastRun.length - 1] + 1) lastRun.push(idx);
    else runs.push([idx]);
  });

  const marksForMaxSpeed = parseSegmentMarks(trip);
  let totalMeters = 0;
  let maxSpeed = 0;
  runs.forEach((run) => {
    for (let k = 1; k < run.length; k++) {
      const p1 = raw[run[k - 1]];
      const p2 = raw[run[k]];
      totalMeters += haversineMeters(p1, p2);
      const touchesMark = marksForMaxSpeed.some(
        (m) => (p1.ts >= m.startTs && p1.ts <= m.endTs) || (p2.ts >= m.startTs && p2.ts <= m.endTs)
      );
      if (!touchesMark) {
        const speed = Math.min(segmentSpeedKmh(p1, p2), PLAUSIBLE_MAX_CAR_KMH);
        if (speed > maxSpeed) maxSpeed = speed;
      }
    }
  });

  const keptPoints = keptIndices.map((i) => raw[i]);
  const newDurationMinutes = (newEndTs - newStartTs) / 60000;
  const cutMinutes = excluded.reduce((sum, [s, e]) => sum + (e - s) / 60000, 0);
  const newPausedMinutes = (trip.pausedMinutes || 0) + cutMinutes;
  const drivingMinutes = Math.max(0, newDurationMinutes - newPausedMinutes);
  const avgSpeedKmh = drivingMinutes > 0 ? totalMeters / 1000 / (drivingMinutes / 60) : 0;

  const newMarks = marksForMaxSpeed
    .map((m) => {
      const s = Math.min(Math.max(m.startTs, newStartTs), newEndTs);
      const e = Math.min(Math.max(m.endTs, newStartTs), newEndTs);
      if (s >= e) return null;
      if (excluded.some(([es, ee]) => s >= es && e <= ee)) return null;
      return { label: m.label, startTs: s, endTs: e };
    })
    .filter(Boolean);

  return {
    ...trip,
    startTimestamp: newStartTs,
    endTimestamp: newEndTs,
    distanceMeters: totalMeters,
    avgSpeedKmh,
    maxSpeedKmh: maxSpeed > 0 ? maxSpeed : trip.maxSpeedKmh,
    pausedMinutes: newPausedMinutes,
    segmentMarksJson: segmentMarksToJson(newMarks),
    gpxTrackJson: JSON.stringify(keptPoints.map((p) => ({ lat: p.lat, lon: p.lon, ts: p.ts }))),
  };
}

function replaceTripInBackupData(oldTrip, newTrip) {
  const idx = backupData.trips.indexOf(oldTrip);
  if (idx !== -1) backupData.trips[idx] = newTrip;
  else backupData.trips.push(newTrip);
}

function pendingLabelsChanged() {
  return JSON.stringify(editPendingLabels) !== JSON.stringify(labelList(editTrip));
}
function pendingMarksChanged() {
  return JSON.stringify(editPendingMarks) !== JSON.stringify(parseSegmentMarks(editTrip));
}

function openTripEdit(trip) {
  editTrip = trip;
  editPendingLabels = labelList(trip);
  editPendingMarks = parseSegmentMarks(trip);
  editMarkA = null;
  editMarkB = null;
  editPendingActions = [];
  // Explizit zurückgesetzt (nicht erst durch renderEditGraph() im setTimeout unten) - sonst
  // würden "Punkt A/B setzen" für einen kurzen Moment mit dem Graph-State der VORHERIGEN Fahrt
  // aktiviert bleiben, bis der neue Graph nach 50ms tatsächlich gezeichnet ist.
  editGraphState = null;

  document.getElementById("trip-edit-title").textContent = `Bearbeiten: ${trip.name}`;
  renderEditLabelChips();
  renderEditMarkInfo();
  renderEditPendingActions();
  renderEditSegmentList();
  updateEditControlsEnabled();

  showScreen("edit");

  setTimeout(() => {
    if (!editMap) {
      editMap = L.map("trip-edit-map", { zoomControl: true, preferCanvas: true });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }).addTo(editMap);
    } else {
      editMapLayers.forEach((l) => editMap.removeLayer(l));
      editMapLayers = [];
      editMapAMarker = null;
      editMapBMarker = null;
    }
    const points = parseTripPoints(trip);
    if (points.length >= 2) {
      const line = L.polyline(points, { color: "#ff7a1a", weight: 4 }).addTo(editMap);
      editMapLayers.push(line);
      renderEditMapSegmentLines();
      editMap.fitBounds(points, { padding: [20, 20] });
    }
    editMap.invalidateSize();
    renderEditGraph(trip);
  }, 50);
}

function renderEditMapSegmentLines() {
  const raw = parseTripPointsWithTime(editTrip);
  editPendingMarks.forEach((mark) => {
    const inRange = raw.filter((p) => p.ts >= mark.startTs && p.ts <= mark.endTs).map((p) => [p.lat, p.lon]);
    if (inRange.length < 2) return;
    const line = L.polyline(inRange, { color: labelColor(mark.label), weight: 6, dashArray: "10, 8" }).addTo(editMap);
    editMapLayers.push(line);
  });
}

function redrawEditMapMarks() {
  if (!editMap) return;
  editMapLayers.forEach((l) => editMap.removeLayer(l));
  editMapLayers = [];
  editMapAMarker = null;
  editMapBMarker = null;
  const points = parseTripPoints(editTrip);
  if (points.length >= 2) {
    editMapLayers.push(L.polyline(points, { color: "#ff7a1a", weight: 4 }).addTo(editMap));
  }
  renderEditMapSegmentLines();
  updateEditAbMapMarkers();
}

function updateEditAbMapMarkers() {
  if (!editMap) return;
  const raw = parseTripPointsWithTime(editTrip);
  const nearest = (ts) => {
    let best = null, bestDiff = Infinity;
    raw.forEach((p) => { const d = Math.abs(p.ts - ts); if (d < bestDiff) { bestDiff = d; best = p; } });
    return best;
  };
  if (editMarkA != null) {
    const p = nearest(editMarkA);
    if (p) {
      if (!editMapAMarker) editMapAMarker = L.circleMarker([p.lat, p.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#7C4DFF", fillOpacity: 1 }).addTo(editMap);
      else editMapAMarker.setLatLng([p.lat, p.lon]);
    }
  } else if (editMapAMarker) {
    editMap.removeLayer(editMapAMarker);
    editMapAMarker = null;
  }
  if (editMarkB != null) {
    const p = nearest(editMarkB);
    if (p) {
      if (!editMapBMarker) editMapBMarker = L.circleMarker([p.lat, p.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#7C4DFF", fillOpacity: 1 }).addTo(editMap);
      else editMapBMarker.setLatLng([p.lat, p.lon]);
    }
  } else if (editMapBMarker) {
    editMap.removeLayer(editMapBMarker);
    editMapBMarker = null;
  }
}

/** Zeichnet den Bearbeiten-Graph: eigenständig statt renderSpeedGraph() wiederzuverwenden, da hier
 * zusätzlich A/B-Marker + hervorgehobene Bereiche gebraucht werden und keine Fixierung auf
 * detailMap/#speed-graph-canvas sinnvoll wäre. */
function renderEditGraph(trip) {
  const canvas = document.getElementById("edit-graph-canvas");
  const emptyHint = document.getElementById("edit-graph-empty-hint");
  const ctx = canvas.getContext("2d");
  const points = getTripSpeedSeries(trip);

  if (points.length < 2) {
    canvas.classList.add("hidden");
    emptyHint.classList.remove("hidden");
    editGraphState = null;
    editGraphRedraw = null;
    return;
  }
  canvas.classList.remove("hidden");
  emptyHint.classList.add("hidden");

  const maxSpeed = Math.max(1, trip.maxSpeedKmh || 0);
  const scaleMax = niceCeilSpeed(maxSpeed);
  const totalDuration = Math.max(1, points[points.length - 1].offsetSeconds);
  const startTs = points[0].timestamp;
  const leftGutter = 34;
  editGraphState = { points, scaleMax, totalDuration, startTs, selectedIndex: points.length - 1 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function xForTs(ts, w) {
    const offsetSeconds = Math.min(totalDuration, Math.max(0, (ts - startTs) / 1000));
    const plotW = Math.max(1, w - leftGutter);
    return leftGutter + (offsetSeconds / totalDuration) * plotW;
  }

  function draw() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    const plotW = Math.max(1, w - leftGutter);

    // Hervorgehobene Bereiche zuerst (bestehende/geplante Markierungen + geplante Pausen-Cuts)
    editPendingMarks.forEach((m) => {
      const x1 = xForTs(m.startTs, w), x2 = xForTs(m.endTs, w);
      ctx.fillStyle = "rgba(38, 198, 218, 0.18)";
      ctx.fillRect(x1, 0, x2 - x1, h);
    });
    editPendingActions.filter((a) => a.type === "cut").forEach((a) => {
      const x1 = xForTs(a.start, w), x2 = xForTs(a.end, w);
      ctx.fillStyle = "rgba(255, 179, 0, 0.2)";
      ctx.fillRect(x1, 0, x2 - x1, h);
    });

    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    [0, 1 / 3, 2 / 3, 1].forEach((frac) => {
      const y = h - frac * h;
      const value = Math.round(scaleMax * frac);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftGutter, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(237, 224, 212, 0.55)";
      ctx.fillText(`${value}`, leftGutter - 6, Math.min(h - 6, Math.max(7, y)));
    });

    ctx.strokeStyle = "#ff7a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = leftGutter + (p.offsetSeconds / totalDuration) * plotW;
      const y = h - Math.min(1, p.speedKmh / scaleMax) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // A/B-Bearbeitungsmarker
    [["A", editMarkA], ["B", editMarkB]].forEach(([label, ts]) => {
      if (ts == null) return;
      const x = xForTs(ts, w);
      ctx.save();
      ctx.strokeStyle = "#b39cff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#b39cff";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 3, 10);
    });

    const sel = points[editGraphState.selectedIndex];
    const selX = leftGutter + (sel.offsetSeconds / totalDuration) * plotW;
    const selY = h - Math.min(1, sel.speedKmh / scaleMax) * h;
    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(selX, selY, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff7a1a";
    ctx.stroke();
  }

  function selectAtClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - leftGutter);
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left - leftGutter) / plotW));
    editGraphState.selectedIndex = Math.min(points.length - 1, Math.max(0, Math.round(fraction * (points.length - 1))));
    updateEditControlsEnabled();
    draw();
  }

  let dragging = false;
  canvas.onpointerdown = (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); selectAtClientX(e.clientX); };
  canvas.onpointermove = (e) => { if (dragging || e.pointerType === "mouse") selectAtClientX(e.clientX); };
  canvas.onpointerup = () => { dragging = false; };
  canvas.onpointercancel = () => { dragging = false; };

  editGraphRedraw = () => { resizeCanvas(); draw(); };
  resizeCanvas();
  draw();
}

function renderEditLabelChips() {
  const container = document.getElementById("edit-label-chips");
  const custom = editPendingLabels.filter((l) => !LABEL_PRESETS.includes(l));
  container.innerHTML = "";

  LABEL_PRESETS.forEach((preset) => {
    const active = editPendingLabels.includes(preset);
    const chip = document.createElement("button");
    chip.className = "chip" + (active ? " selected" : "");
    chip.textContent = preset;
    chip.addEventListener("click", () => {
      editPendingLabels = active ? editPendingLabels.filter((l) => l !== preset) : editPendingLabels.concat(preset);
      renderEditLabelChips();
    });
    container.appendChild(chip);
  });
  custom.forEach((label) => {
    const chip = document.createElement("button");
    chip.className = "chip selected";
    chip.textContent = `${labelIcon(label)} ${label}`;
    chip.addEventListener("click", () => {
      editPendingLabels = editPendingLabels.filter((l) => l !== label);
      renderEditLabelChips();
    });
    container.appendChild(chip);
  });
  const addChip = document.createElement("button");
  addChip.className = "chip";
  addChip.textContent = "+ eigenes Label";
  addChip.addEventListener("click", () => {
    const text = (prompt("Eigenes Label:") || "").trim();
    if (text) {
      editPendingLabels = editPendingLabels.concat(text);
      renderEditLabelChips();
    }
  });
  container.appendChild(addChip);
}

function renderEditMarkInfo() {
  const el = document.getElementById("edit-mark-info");
  if (editMarkA == null && editMarkB == null) {
    el.classList.add("hidden");
    document.getElementById("edit-reset-selection-btn").classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  document.getElementById("edit-reset-selection-btn").classList.remove("hidden");
  const parts = [];
  if (editMarkA != null) parts.push(`A = ${new Date(editMarkA).toLocaleTimeString("de-DE")}`);
  if (editMarkB != null) parts.push(`B = ${new Date(editMarkB).toLocaleTimeString("de-DE")}`);
  el.innerHTML = `<span>${parts.join("   ")}</span>`;
}

function renderEditPendingActions() {
  const container = document.getElementById("edit-pending-list");
  const applyBtn = document.getElementById("edit-apply-btn");
  if (editPendingActions.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    applyBtn.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  applyBtn.classList.remove("hidden");
  container.innerHTML = editPendingActions
    .map(
      (action, i) =>
        `<div class="edit-pending-row"><span>${escapeHtml(action.description)}</span><button data-index="${i}">✕</button></div>`
    )
    .join("");
  container.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editPendingActions.splice(Number(btn.dataset.index), 1);
      renderEditPendingActions();
      if (editGraphState) renderEditGraph(editTrip);
    });
  });
}

function renderEditSegmentList() {
  const container = document.getElementById("edit-segment-list");
  if (editPendingMarks.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.classList.remove("hidden");
  container.innerHTML =
    '<div class="segment-list-header">Markierte Abschnitte</div>' +
    editPendingMarks
      .map((mark, i) => {
        const stats = computeSegmentStats(editTrip, mark);
        const startTime = new Date(mark.startTs).toLocaleTimeString("de-DE");
        const endTime = new Date(mark.endTs).toLocaleTimeString("de-DE");
        return `
          <div class="segment-row">
            <span class="segment-color-dot" style="background:${labelColor(mark.label)}"></span>
            <div class="segment-row-text">
              <div class="title">${labelIcon(mark.label)} ${escapeHtml(mark.label)}: ${startTime}–${endTime}</div>
              <div class="stats">${stats.distanceKm.toFixed(1)} km · ${formatTripDuration(stats.durationMinutes)} · Ø ${Math.round(stats.avgSpeedKmh)} km/h · Max ${Math.round(stats.maxSpeedKmh)} km/h</div>
            </div>
            <button class="segment-delete-btn" data-index="${i}">✕</button>
          </div>
        `;
      })
      .join("");
  container.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editPendingMarks.splice(Number(btn.dataset.index), 1);
      renderEditSegmentList();
      redrawEditMapMarks();
      if (editGraphState) renderEditGraph(editTrip);
    });
  });
}

function updateEditControlsEnabled() {
  const hasScrub = Boolean(editGraphState);
  document.getElementById("edit-set-a-btn").disabled = !hasScrub;
  document.getElementById("edit-set-b-btn").disabled = !hasScrub;
  document.getElementById("edit-trim-start-btn").disabled = editMarkA == null;
  document.getElementById("edit-trim-end-btn").disabled = editMarkB == null;
  document.getElementById("edit-cut-pause-btn").disabled = editMarkA == null || editMarkB == null;
  document.getElementById("edit-mark-segment-btn").disabled = editMarkA == null || editMarkB == null;
}

document.getElementById("trip-detail-edit").addEventListener("click", () => {
  if (currentDetailTrip) openTripEdit(currentDetailTrip);
});

document.getElementById("edit-set-a-btn").addEventListener("click", () => {
  if (!editGraphState) return;
  editMarkA = editGraphState.points[editGraphState.selectedIndex].timestamp;
  renderEditMarkInfo();
  updateEditControlsEnabled();
  updateEditAbMapMarkers();
  renderEditGraph(editTrip);
});
document.getElementById("edit-set-b-btn").addEventListener("click", () => {
  if (!editGraphState) return;
  editMarkB = editGraphState.points[editGraphState.selectedIndex].timestamp;
  renderEditMarkInfo();
  updateEditControlsEnabled();
  updateEditAbMapMarkers();
  renderEditGraph(editTrip);
});
document.getElementById("edit-reset-selection-btn").addEventListener("click", () => {
  editMarkA = null;
  editMarkB = null;
  renderEditMarkInfo();
  updateEditControlsEnabled();
  updateEditAbMapMarkers();
  renderEditGraph(editTrip);
});

document.getElementById("edit-trim-start-btn").addEventListener("click", () => {
  if (editMarkA == null) return;
  editPendingActions = editPendingActions.filter((a) => a.type !== "trimStart");
  editPendingActions.push({
    type: "trimStart",
    ts: editMarkA,
    description: `Anfang bis ${new Date(editMarkA).toLocaleTimeString("de-DE")} abschneiden`,
  });
  renderEditPendingActions();
});
document.getElementById("edit-trim-end-btn").addEventListener("click", () => {
  if (editMarkB == null) return;
  editPendingActions = editPendingActions.filter((a) => a.type !== "trimEnd");
  editPendingActions.push({
    type: "trimEnd",
    ts: editMarkB,
    description: `B bis Ende abschneiden (ab ${new Date(editMarkB).toLocaleTimeString("de-DE")})`,
  });
  renderEditPendingActions();
});
document.getElementById("edit-cut-pause-btn").addEventListener("click", () => {
  if (editMarkA == null || editMarkB == null) return;
  const start = Math.min(editMarkA, editMarkB);
  const end = Math.max(editMarkA, editMarkB);
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  editPendingActions.push({
    type: "cut",
    start,
    end,
    description: `Pause entfernt: ${new Date(start).toLocaleTimeString("de-DE")}–${new Date(end).toLocaleTimeString("de-DE")} (${minutes} min)`,
  });
  renderEditPendingActions();
  renderEditGraph(editTrip);
});

document.getElementById("edit-mark-segment-btn").addEventListener("click", () => {
  if (editMarkA == null || editMarkB == null) return;
  const start = Math.min(editMarkA, editMarkB);
  const end = Math.max(editMarkA, editMarkB);
  const text = prompt(
    `Label für diesen Abschnitt (${new Date(start).toLocaleTimeString("de-DE")}–${new Date(end).toLocaleTimeString("de-DE")}), ` +
      `z.B. "${LABEL_PRESETS.join('", "')}":`,
    LABEL_PRESETS[0]
  );
  const label = (text || "").trim();
  if (!label) return;
  editPendingMarks = editPendingMarks.concat({ label, startTs: start, endTs: end });
  renderEditSegmentList();
  redrawEditMapMarks();
  renderEditGraph(editTrip);
});

function currentEditLabelsString() {
  return editPendingLabels
    .map((l) => l.replace(/,/g, "").trim())
    .filter(Boolean)
    .join(",");
}

async function saveAndCloseEditScreen(updatedTrip) {
  const applyBtn = document.getElementById("edit-apply-btn");
  applyBtn.disabled = true;
  try {
    await pushBackupConflictSafe();
    editTrip = null;
    showScreen("detail");
    openTripDetail(updatedTrip);
  } catch (e) {
    alert("Speichern fehlgeschlagen: " + (e.message || e));
  } finally {
    applyBtn.disabled = false;
  }
}

document.getElementById("edit-apply-btn").addEventListener("click", () => {
  if (!confirm("Diese Änderung kann nicht rückgängig gemacht werden. Fortfahren?")) return;
  const plan = {
    trimStartTs: editPendingActions.find((a) => a.type === "trimStart")?.ts ?? null,
    trimEndTs: editPendingActions.find((a) => a.type === "trimEnd")?.ts ?? null,
    pauseCuts: editPendingActions.filter((a) => a.type === "cut").map((a) => [a.start, a.end]),
  };
  const tripWithPendingMetadata = {
    ...editTrip,
    labels: currentEditLabelsString(),
    segmentMarksJson: segmentMarksToJson(editPendingMarks),
  };
  const updatedTrip = applyTripEditPlanJs(tripWithPendingMetadata, plan);
  if (!updatedTrip) {
    alert("Änderung ungültig (zu wenige Punkte übrig)");
    return;
  }
  replaceTripInBackupData(editTrip, updatedTrip);
  saveAndCloseEditScreen(updatedTrip);
});

function attemptEditBack() {
  const hasUnsavedMetadata = pendingLabelsChanged() || pendingMarksChanged();
  const hasUnappliedCuts = editPendingActions.length > 0;

  if (!hasUnsavedMetadata && !hasUnappliedCuts) {
    editTrip = null;
    showScreen("detail");
    return;
  }

  if (hasUnsavedMetadata) {
    const wantsSave = confirm(
      "Ungespeicherte Änderungen an Labels/Markierungen." +
        (hasUnappliedCuts ? " Geplante Zuschnitte werden dabei NICHT angewendet und gehen verloren." : "") +
        "\n\nOK = Speichern, Abbrechen = Verwerfen und verlassen."
    );
    if (wantsSave) {
      const newMax = recomputeMaxSpeedExcludingMarks(editTrip, editPendingMarks);
      const updatedTrip = {
        ...editTrip,
        labels: currentEditLabelsString(),
        segmentMarksJson: segmentMarksToJson(editPendingMarks),
        maxSpeedKmh: newMax,
      };
      replaceTripInBackupData(editTrip, updatedTrip);
      saveAndCloseEditScreen(updatedTrip);
      return;
    }
  } else if (hasUnappliedCuts) {
    if (!confirm("Geplante Zuschnitte wurden noch nicht angewendet und gehen beim Verlassen verloren. Trotzdem verlassen?")) {
      return;
    }
  }
  const trip = editTrip;
  editTrip = null;
  showScreen("detail");
  openTripDetail(trip);
}

document.getElementById("trip-edit-back").addEventListener("click", attemptEditBack);

// Selber globaler Resize-Handler-Ansatz wie bei der Detailseite, nur für den Bearbeiten-Graphen.
window.addEventListener("resize", () => { if (editGraphRedraw) editGraphRedraw(); });

// --- Geschwindigkeits-Graph ein-/ausblenden ---
// Präferenz bleibt über localStorage erhalten, gilt für alle Fahrten (nicht pro Fahrt gespeichert).
const GRAPH_COLLAPSED_KEY = "drivetrack_graph_collapsed";
function applyGraphCollapsedState() {
  const collapsed = localStorage.getItem(GRAPH_COLLAPSED_KEY) === "1";
  document.getElementById("trip-detail-graph-section").classList.toggle("collapsed", collapsed);
  document.getElementById("graph-toggle-btn").textContent = collapsed ? "Anzeigen" : "Ausblenden";
  return collapsed;
}
document.getElementById("graph-toggle-btn").addEventListener("click", () => {
  const wasCollapsed = localStorage.getItem(GRAPH_COLLAPSED_KEY) === "1";
  localStorage.setItem(GRAPH_COLLAPSED_KEY, wasCollapsed ? "0" : "1");
  applyGraphCollapsedState();
  // Canvas hatte während des Ausgeblendetseins Breite/Höhe 0 - beim erneuten Einblenden neu
  // vermessen und zeichnen, sonst bleibt es leer.
  if (wasCollapsed && currentGraphRedraw) currentGraphRedraw();
  // Leaflet merkt sich die Kartengröße selbst und füllt neuen Platz NICHT automatisch, nur weil
  // der Container per CSS größer wird - ohne invalidateSize() bleiben Kacheln grau/abgeschnitten.
  // setTimeout, damit das Layout (Graph ein-/ausgeblendet) erst fertig reflowed ist.
  setTimeout(() => { if (detailMap) detailMap.invalidateSize(); }, 50);
});

// --- Routen-Farbmodus (Standard-Farbe / nach Geschwindigkeit) ---
// Präferenz bleibt über localStorage erhalten, gilt für alle Fahrten (nicht pro Fahrt gespeichert).
const ROUTE_COLOR_MODE_KEY = "drivetrack_route_color_mode";
function applyRouteColorModeSelection() {
  const mode = localStorage.getItem(ROUTE_COLOR_MODE_KEY) || "standard";
  document.getElementById("route-color-mode").value = mode;
  document.getElementById("route-color-legend").classList.toggle("hidden", mode !== "speed");
}
document.getElementById("route-color-mode").addEventListener("change", (e) => {
  localStorage.setItem(ROUTE_COLOR_MODE_KEY, e.target.value);
  document.getElementById("route-color-legend").classList.toggle("hidden", e.target.value !== "speed");
  if (currentDetailTrip && detailMap) {
    renderRouteLine(currentDetailTrip, parseTripPoints(currentDetailTrip));
  }
});
// Legende einmalig mit der echten Farbfunktion befüllen, statt die Farben separat in CSS zu
// duplizieren (garantiert, dass sie exakt zur tatsächlichen Route-Einfärbung passt). Feine
// 10-km/h-Schritte, damit der Knick bei 130 (rot) glatt in den Verlauf übergeht.
// Seit v1.9.0 zwei Legenden im DOM (Fahrt-Detail + Gruppen-Route) - beide über dieselbe echte
// Farbfunktion befüllt, damit sie garantiert identisch mit der jeweiligen Routen-Einfärbung bleiben.
const legendStops = [];
for (let v = 0; v <= ROUTE_COLOR_PURPLE_KMH; v += 10) legendStops.push(speedToColor(v));
document.querySelectorAll(".route-color-legend-bar").forEach((el) => {
  el.style.background = `linear-gradient(to right, ${legendStops.join(", ")})`;
});
// "130"-Tick an die tatsächliche Position seines Werts im Gradienten setzen (130/180 ≈ 72%),
// statt ihn per Flexbox in die Mitte zu zwingen, wo eigentlich eine andere Farbe/Geschwindigkeit sitzt.
["route-color-legend-mid", "group-route-color-legend-mid"].forEach((id) => {
  document.getElementById(id).style.left = `${(ROUTE_COLOR_RED_KMH / ROUTE_COLOR_PURPLE_KMH) * 100}%`;
});

// --- Automatische Synchronisation ---
// Die App synchronisiert seit 0.3.0 selbst automatisch nach jeder Fahrt - hier holen wir uns
// periodisch die neuesten Daten ab, damit man sie nicht erst per Hand "neu laden" muss. Nur
// solange eingeloggt+entsperrt (dek gesetzt), sonst macht loadAndRenderBackup() eh nichts.
// Läuft bewusst NICHT, während man gerade in der Fahrt-Detail- oder Settings-Ansicht ist, damit
// kein Reload mitten in einer Interaktion die Ansicht wegreißt.
const AUTO_REFRESH_INTERVAL_MS = 60_000;

function canAutoRefreshNow() {
  return Boolean(session && dek) && (screens.detail.classList.contains("hidden")) &&
    (screens.edit.classList.contains("hidden")) &&
    (screens.group.classList.contains("hidden")) &&
    (screens.groupRoute.classList.contains("hidden")) &&
    (screens.groupPicker.classList.contains("hidden")) &&
    (screens.settings.classList.contains("hidden"));
}

setInterval(() => {
  if (canAutoRefreshNow()) loadAndRenderBackup();
}, AUTO_REFRESH_INTERVAL_MS);

// Sofort neu laden, wenn man in den Tab zurückwechselt (z. B. nachdem man am Handy gerade eine
// Fahrt beendet hat) - fühlt sich responsiver an als auf das nächste 60s-Intervall zu warten.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && canAutoRefreshNow()) loadAndRenderBackup();
});

boot();
