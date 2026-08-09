const BASE_URL = "https://drivetrack-api.kornel-riedl.de/api";

async function request(path, method, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(json.error || `Fehler ${res.status}`);
  }
  return json;
}

export const api = {
  register: (data) => request("/register", "POST", data),
  login: (username, password) => request("/login", "POST", { username, password }),
  requestReset: (email) => request("/request-reset", "POST", { email }),
  verifyResetCode: (email, code) => request("/verify-reset-code", "POST", { email, code }),
  confirmReset: (data) => request("/confirm-reset", "POST", data),
  downloadBackup: (token) => request("/backup", "GET", null, token),
  // Seit v1.7.0: erster Schreibpfad der Web-App (war bisher bewusst rein lesend, siehe CLAUDE.md) -
  // mirrors ServerApi.kt (uploadBackup/backupHistory/downloadBackupVersion) in der Android-App 1:1.
  uploadBackup: (token, ciphertext, iv) => request("/backup", "POST", { ciphertext, iv }, token),
  // Liefert ein rohes JSON-*Array* (kein Objekt) - JSON.parse() oben handhabt das problemlos,
  // anders als der Kotlin-Client (org.json.JSONObject), wo das erst ein Bug war (siehe App-CLAUDE.md).
  getBackupHistory: (token) => request("/backup/history", "GET", null, token),
  getBackupVersion: (token, id) => request(`/backup/${id}`, "GET", null, token),
};
