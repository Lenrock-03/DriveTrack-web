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
    await loadAndRenderBackup();
    showScreen("main");
    setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
  } catch (e) {
    errorEl.textContent = e.message || "Login fehlgeschlagen";
  }
});

document.getElementById("show-register").addEventListener("click", () => showScreen("register"));
document.getElementById("show-login").addEventListener("click", () => showScreen("login"));

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

// --- Entsperren (nach Reload, Token schon vorhanden) ---
document.getElementById("unlock-btn").addEventListener("click", async () => {
  const password = document.getElementById("unlock-password").value;
  const errorEl = document.getElementById("unlock-error");
  errorEl.textContent = "";
  if (!password || !session) return;

  try {
    const wrapped = cryptoUtil.wrappedStringToBlob(session.dekWrappedPassword);
    dek = await cryptoUtil.unwrapDek(wrapped, password, session.passwordSalt);
    await loadAndRenderBackup();
    showScreen("main");
    setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
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
      <div class="meta"><span>${km} km</span><span>${durationMin} min</span></div>
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

  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
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
  mainMapLayers.forEach((l) => mainMap.removeLayer(l));
  mainMapLayers = [];

  const allPoints = [];
  trips.forEach((trip) => {
    const points = parseTripPoints(trip);
    if (points.length < 2) return;
    const line = L.polyline(points, { color: "#ff7a1a", weight: 4, opacity: 0.85 }).addTo(mainMap);
    mainMapLayers.push(line);
    allPoints.push(...points);
  });

  if (allPoints.length > 0) {
    mainMap.fitBounds(allPoints, { padding: [30, 30] });
  }
}

// --- Fahrt-Detail ---
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
      <div class="stat-tile"><div class="value">${durationMin} min</div><div class="label">Dauer</div></div>
      <div class="stat-tile"><div class="value">${trip.avgSpeedKmh.toFixed(0)} km/h</div><div class="label">Ø Geschwindigkeit</div></div>
      <div class="stat-tile"><div class="value">${trip.maxSpeedKmh.toFixed(0)} km/h</div><div class="label">Max. Geschwindigkeit</div></div>
    </div>
  `;

  showScreen("detail");

  // Karte erst nach dem Sichtbarwerden initialisieren (Leaflet braucht sichtbare Größe)
  setTimeout(() => {
    if (!detailMap) {
      detailMap = L.map("trip-detail-map", { zoomControl: true });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }).addTo(detailMap);
    } else {
      detailMap.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) detailMap.removeLayer(layer);
      });
    }

    const points = parseTripPoints(trip);
    if (points.length >= 2) {
      L.polyline(points, { color: "#ff7a1a", weight: 5 }).addTo(detailMap);
      L.circleMarker(points[0], { radius: 7, color: "#fff", fillColor: "#43a047", fillOpacity: 1, weight: 2 }).addTo(detailMap);
      L.circleMarker(points[points.length - 1], { radius: 7, color: "#fff", fillColor: "#212121", fillOpacity: 1, weight: 2 }).addTo(detailMap);
      detailMap.fitBounds(points, { padding: [30, 30] });
    }
    detailMap.invalidateSize();
  }, 50);
}

document.getElementById("trip-detail-back").addEventListener("click", () => {
  showScreen("main");
  setTimeout(() => mainMap && mainMap.invalidateSize(), 50);
});

boot();
