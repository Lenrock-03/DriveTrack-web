import { api } from "./api.js";
import * as cryptoUtil from "./crypto.js";

const STORAGE_KEY = "drivetrack_session";

// --- Zustand ---
let session = loadSession(); // { token, username, email, passwordSalt, dekWrappedPassword } | null
let dek = null; // NIE persistiert, nur im Speicher dieser Seite
let backupData = { users: [], cars: [], trips: [] };
let selectedCarId = "";
let currentTab = "home";
let mainMap = null;
let mainMapLayers = [];
let detailMap = null;
let graphScrubMarker = null; // Leaflet-Marker auf detailMap, zeigt die im Graph gewählte Position
let currentGraphRedraw = null; // Redraw-Funktion der gerade offenen Fahrt, für den globalen Resize-Handler
let currentDetailTrip = null; // Fahrt der gerade offenen Detail-Ansicht, für den Farbmodus-Umschalter
let routeLineLayers = []; // Aktuell auf detailMap gezeichnete Routen-Layer (Linie(n) + Hover-Trefferfläche)

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
      email: session?.email || "",
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
document.getElementById("settings-logout-btn").addEventListener("click", () => {
  clearSession();
  showScreen("login");
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
  };
  renderCarSelector();
  renderTab();
}

document.getElementById("settings-reload-btn").addEventListener("click", async () => {
  await loadAndRenderBackup();
  alert("Daten neu geladen");
});

document.getElementById("settings-username-label").textContent = "";
// Einzige Quelle der Wahrheit für die Versionsnummer ist der <meta name="app-version">-Tag in
// index.html (kein Build-Step hier, der eine Konstante an mehreren Stellen einsetzen könnte).
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "?";
document.getElementById("settings-version-label").textContent = `Version ${APP_VERSION}`;
document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-username-label").textContent =
    `Eingeloggt als "${session?.username || ""}"`;
  showScreen("settings");
});
document.getElementById("settings-back").addEventListener("click", () => showScreen("main"));

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

// --- Rendering ---
function renderTab() {
  const trips = filteredTrips();

  if (currentTab === "home") {
    document.getElementById("stats-panel").classList.remove("hidden");
    renderStats(trips);
    renderTripList(trips.slice(0, 5));
  } else {
    document.getElementById("stats-panel").classList.add("hidden");
    renderTripList(trips);
  }
  renderMainMap(trips);
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

function renderTripList(trips) {
  const list = document.getElementById("trip-list");
  list.innerHTML = "";

  if (trips.length === 0) {
    list.innerHTML = '<div class="empty-hint">Noch keine Fahrten vorhanden.</div>';
    return;
  }

  trips.forEach((trip) => {
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

    row.appendChild(text);
    row.appendChild(canvas);
    row.addEventListener("click", () => openTripDetail(trip));
    list.appendChild(row);
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
const legendStops = [];
for (let v = 0; v <= ROUTE_COLOR_PURPLE_KMH; v += 10) legendStops.push(speedToColor(v));
document.querySelector(".route-color-legend-bar").style.background =
  `linear-gradient(to right, ${legendStops.join(", ")})`;
// "130"-Tick an die tatsächliche Position seines Werts im Gradienten setzen (130/180 ≈ 72%),
// statt ihn per Flexbox in die Mitte zu zwingen, wo eigentlich eine andere Farbe/Geschwindigkeit sitzt.
document.getElementById("route-color-legend-mid").style.left =
  `${(ROUTE_COLOR_RED_KMH / ROUTE_COLOR_PURPLE_KMH) * 100}%`;

// --- Automatische Synchronisation ---
// Die App synchronisiert seit 0.3.0 selbst automatisch nach jeder Fahrt - hier holen wir uns
// periodisch die neuesten Daten ab, damit man sie nicht erst per Hand "neu laden" muss. Nur
// solange eingeloggt+entsperrt (dek gesetzt), sonst macht loadAndRenderBackup() eh nichts.
// Läuft bewusst NICHT, während man gerade in der Fahrt-Detail- oder Settings-Ansicht ist, damit
// kein Reload mitten in einer Interaktion die Ansicht wegreißt.
const AUTO_REFRESH_INTERVAL_MS = 60_000;

function canAutoRefreshNow() {
  return Boolean(session && dek) && (screens.detail.classList.contains("hidden")) &&
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
