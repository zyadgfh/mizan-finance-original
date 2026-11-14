const KEY = "mizan.pin";

export async function hashPin(pin: string) {
  const data = new TextEncoder().encode(`mizan.pin.v1:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readPinHash() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writePinHash(hash: string | null) {
  if (hash) localStorage.setItem(KEY, hash);
  else localStorage.removeItem(KEY);
}
