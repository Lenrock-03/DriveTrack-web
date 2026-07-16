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
};
