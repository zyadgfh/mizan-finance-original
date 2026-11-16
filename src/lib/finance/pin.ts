const KEY = "mizan.pin";
const ATTEMPTS_KEY = "mizan.pin.attempts";

/**
 * PIN hashing parameters.
 *
 * The 4-digit PIN is a *device lock*, not a data-encryption key: the ledger is
 * protected by the account credentials and TLS, not by this value. Even so it
 * must not be stored as a fast hash (the previous SHA-256 + fixed prefix could
 * be brute-forced offline in milliseconds), so we derive it with PBKDF2 and a
 * per-device random salt, and throttle guesses on top.
 */
const PBKDF2_ITERATIONS = 210_000;

// Storage shim: localStorage in the browser, an in-memory map elsewhere
// (tests, SSR, or a hardened WebView where storage is unavailable).
const memoryStore = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
  } catch {
    /* fall through */
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  if (value === null) memoryStore.delete(key);
  else memoryStore.set(key, value);
}
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const LEGACY_HASH_RE = /^[0-9a-f]{64}$/i;

export type PinRecord = {
  v: 2;
  alg: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  hash: string;
};

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseRecord(stored: string | null): PinRecord | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<PinRecord>;
    if (
      parsed &&
      parsed.v === 2 &&
      parsed.alg === "PBKDF2-SHA256" &&
      typeof parsed.iterations === "number" &&
      parsed.iterations >= 100_000 &&
      parsed.iterations <= 1_000_000 &&
      typeof parsed.salt === "string" &&
      /^[0-9a-f]{32}$/i.test(parsed.salt) &&
      typeof parsed.hash === "string" &&
      /^[0-9a-f]{64}$/i.test(parsed.hash)
    ) {
      return parsed as PinRecord;
    }
  } catch {
    /* fall through: treat as legacy */
  }
  return null;
}

/**
 * Hashes a PIN into a versioned, salted record (serialized as a JSON string so
 * `readPinHash`/`writePinHash` keep working unchanged).
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  const record: PinRecord = {
    v: 2,
    alg: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toHex(salt),
    hash: toHex(hash),
  };
  return JSON.stringify(record);
}

/**
 * Verifies a PIN against a stored record, transparently supporting the legacy
 * `sha256("mizan.pin.v1:" + pin)` format. When a legacy record verifies, the
 * returned `upgraded` value is a fresh v2 record that the caller should persist.
 */
export async function verifyPin(
  pin: string,
  stored: string | null,
): Promise<{ ok: boolean; upgraded: string | null }> {
  if (!pin || !stored) return { ok: false, upgraded: null };

  const record = parseRecord(stored);
  if (record) {
    try {
      const candidate = await derive(pin, fromHex(record.salt), record.iterations);
      return { ok: constantTimeEqual(toHex(candidate), record.hash.toLowerCase()), upgraded: null };
    } catch {
      return { ok: false, upgraded: null };
    }
  }

  if (LEGACY_HASH_RE.test(stored.trim())) {
    const legacy = await legacySha256(pin);
    if (constantTimeEqual(legacy, stored.trim().toLowerCase())) {
      return { ok: true, upgraded: await hashPin(pin) };
    }
  }

  return { ok: false, upgraded: null };
}

async function legacySha256(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`mizan.pin.v1:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(buf));
}

export function readPinHash(): string | null {
  return readRaw(KEY);
}

export function writePinHash(hash: string | null) {
  writeRaw(KEY, hash);
  clearPinFailures();
}

// ---------------------------------------------------------------------------
// Guess throttling (4 digits = 10k combinations, so rate limiting matters more
// than hash cost on a device that is already unlocked enough to run JS).
// ---------------------------------------------------------------------------
type AttemptState = { fails: number; lockedUntil: number };

function readAttempts(): AttemptState {
  const raw = readRaw(ATTEMPTS_KEY);
  if (!raw) return { fails: 0, lockedUntil: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<AttemptState>;
    return {
      fails: Math.max(0, Number(parsed.fails) || 0),
      lockedUntil: Math.max(0, Number(parsed.lockedUntil) || 0),
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

function writeAttempts(state: AttemptState) {
  writeRaw(ATTEMPTS_KEY, JSON.stringify(state));
}

/** Backoff: 0, 0, 5s, 15s, 60s, then 5 minutes. */
export function pinLockoutRemainingMs(now = Date.now()): number {
  const state = readAttempts();
  return state.lockedUntil > now ? state.lockedUntil - now : 0;
}

export function recordPinFailure(now = Date.now()): number {
  const state = readAttempts();
  const fails = state.fails + 1;
  const delayMs = fails >= 8 ? 300_000 : fails >= 6 ? 60_000 : fails >= 5 ? 15_000 : fails >= 4 ? 5_000 : 0;
  const next: AttemptState = { fails, lockedUntil: delayMs > 0 ? now + delayMs : 0 };
  writeAttempts(next);
  return delayMs;
}

export function clearPinFailures() {
  writeRaw(ATTEMPTS_KEY, null);
}
