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
    // status mit auf den Error packen (nicht nur die Textnachricht) - damit Aufrufer einen
    // abgelaufenen/ungültigen Token (401) zuverlässig erkennen können, ohne auf die genaue
    // (deutsche) Fehlertext-Zeichenkette angewiesen zu sein, siehe loadAndRenderBackup().
    const err = new Error(json.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const api = {
  register: (data) => request("/register", "POST", data),
  login: (username, password) => request("/login", "POST", { username, password }),
  requestReset: (email) => request("/request-reset", "POST", { email }),
  verifyResetCode: (email, code) => request("/verify-reset-code", "POST", { email, code }),
  confirmReset: (data) => request("/confirm-reset", "POST", data),
  // Seit v2.0.0 der einzige Backup-Endpunkt, den diese Seite noch aufruft (reiner Lesepfad, kein
  // uploadBackup/getBackupHistory/getBackupVersion mehr - die Web-App spiegelt nur noch, was die
  // App hochgeladen hat, siehe CLAUDE.md).
  downloadBackup: (token) => request("/backup", "GET", null, token),
};
