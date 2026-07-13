// Ende-zu-Ende-Verschlüsselung, spiegelt exakt ServerCrypto.kt aus der Android-App:
// - Ein zufälliger Datenschlüssel (DEK) verschlüsselt das eigentliche Backup
// - Der DEK wird mit Passwort UND Recovery-Code verpackt gespeichert
// - Alles läuft NUR hier im Browser, der Server sieht nie Passwort/Recovery-Code/DEK im Klartext

const PBKDF2_ITERATIONS = 150000;
const KEY_LENGTH_BITS = 256;
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomSaltBase64() {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export function randomDek() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function randomRecoveryCode() {
  const values = crypto.getRandomValues(new Uint8Array(24));
  let code = "";
  for (let i = 0; i < 24; i++) code += RECOVERY_ALPHABET[values[i] % RECOVERY_ALPHABET.length];
  return code;
}

async function deriveKey(secret, saltBase64) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptRaw(dataBuffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBuffer);
  return { ciphertextBase64: toBase64(ciphertext), ivBase64: toBase64(iv) };
}

async function decryptRaw(blob, key) {
  const iv = fromBase64(blob.ivBase64);
  const ciphertext = fromBase64(blob.ciphertextBase64);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}

// --- DEK mit Passwort/Recovery-Code verpacken & entpacken ---

export async function wrapDek(dek, secret, saltBase64) {
  const key = await deriveKey(secret, saltBase64);
  return encryptRaw(dek, key);
}

export async function unwrapDek(wrappedBlob, secret, saltBase64) {
  const key = await deriveKey(secret, saltBase64);
  const plain = await decryptRaw(wrappedBlob, key);
  return new Uint8Array(plain);
}

// --- Eigentliches Backup mit dem DEK selbst ver-/entschlüsseln ---

export async function encryptWithDek(plainText, dek) {
  const key = await crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["encrypt"]);
  return encryptRaw(new TextEncoder().encode(plainText), key);
}

export async function decryptWithDek(blob, dek) {
  const key = await crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await decryptRaw(blob, key);
  return new TextDecoder().decode(plain);
}

// --- Kombinierte String-Darstellung, für Felder mit nur einer Server-Spalte ---

export function blobToWrappedString(blob) {
  return `${blob.ivBase64}:${blob.ciphertextBase64}`;
}

export function wrappedStringToBlob(s) {
  const idx = s.indexOf(":");
  return { ivBase64: s.slice(0, idx), ciphertextBase64: s.slice(idx + 1) };
}
