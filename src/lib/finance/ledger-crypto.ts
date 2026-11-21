export type LedgerEncryptionMode = "off" | "biometric" | "strict_pin";

export const LEDGER_VAULT_META_KEY = "mizan.ledgerVault.v1";
const IDB_VAULT_DB = "mizan-vault-keystore";
const IDB_VAULT_STORE = "keys";
const IDB_MASTER_KEY_ID = "biometric-wrapping-key-v1";
const PBKDF2_ITERATIONS = 150_000;

export type LedgerVaultMeta = {
  v: 1;
  mode: Exclude<LedgerEncryptionMode, "off">;
  pinSaltB64: string;
  pinIvB64: string;
  pinWrappedDekB64: string;
  keystoreSealedDek?: string;
  idbWrappedIvB64?: string;
  idbWrappedDekB64?: string;
  updatedAt: number;
};

export type EncryptedLedgerEnvelope = {
  __mizanEncryptedLedger: 1;
  v: 1;
  iv: string;
  ct: string;
  updatedAt: number;
};

type NativeVaultWindow = Window & {
  MizanNative?: {
    sealWithKeystore?: (plainText: string) => string;
    unsealWithKeystore?: (packedCipher: string) => string;
    clearVaultSession?: () => boolean;
  };
};

let activeDekBytes: Uint8Array | null = null;
let activeDataKey: CryptoKey | null = null;
const decryptedLedgerMemCache = new Map<string, string>();
const writeSeqByKey = new Map<string, number>();

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function isLedgerKeyName(key: string): boolean {
  return key === "mizan.v1" || (key.startsWith("mizan.tenant.") && key.endsWith(".v1"));
}

export function isEncryptedLedgerEnvelope(value: unknown): value is EncryptedLedgerEnvelope {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return (
        parsed?.__mizanEncryptedLedger === 1 &&
        typeof parsed.iv === "string" &&
        typeof parsed.ct === "string"
      );
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return rec.__mizanEncryptedLedger === 1 && typeof rec.iv === "string" && typeof rec.ct === "string";
}

export function loadVaultMeta(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): LedgerVaultMeta | null {
  try {
    const raw = storage?.getItem(LEDGER_VAULT_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LedgerVaultMeta>;
    if (
      parsed?.v === 1 &&
      (parsed.mode === "biometric" || parsed.mode === "strict_pin") &&
      typeof parsed.pinSaltB64 === "string" &&
      typeof parsed.pinIvB64 === "string" &&
      typeof parsed.pinWrappedDekB64 === "string"
    ) {
      return parsed as LedgerVaultMeta;
    }
    return null;
  } catch {
    return null;
  }
}

export function getLedgerEncryptionMode(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): LedgerEncryptionMode {
  return loadVaultMeta(storage)?.mode ?? "off";
}

export function hasUnlockedLedgerKey(): boolean {
  return activeDataKey !== null && activeDekBytes !== null;
}

export function requiresStrictPinColdUnlock(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): boolean {
  const mode = getLedgerEncryptionMode(storage);
  return mode === "strict_pin" && !hasUnlockedLedgerKey();
}

async function derivePinKek(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importDataKey(dekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    dekBytes as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptStringWithKey(key: CryptoKey, plainText: string): Promise<EncryptedLedgerEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ptBytes = new TextEncoder().encode(plainText);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ptBytes);
  return {
    __mizanEncryptedLedger: 1,
    v: 1,
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ctBuf)),
    updatedAt: Date.now(),
  };
}

async function decryptEnvelopeWithKey(key: CryptoKey, env: EncryptedLedgerEnvelope): Promise<string> {
  const iv = fromB64(env.iv);
  const ct = fromB64(env.ct);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(ptBuf);
}

async function openVaultIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_VAULT_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_VAULT_STORE)) {
          req.result.createObjectStore(IDB_VAULT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getOrCreateIdbMasterKey(): Promise<CryptoKey | null> {
  const db = await openVaultIdb();
  if (!db) return null;
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve) => {
      const tx = db.transaction(IDB_VAULT_STORE, "readonly");
      const req = tx.objectStore(IDB_VAULT_STORE).get(IDB_MASTER_KEY_ID);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => resolve(undefined);
    });
    if (existing) {
      db.close();
      return existing;
    }
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_VAULT_STORE, "readwrite");
      tx.objectStore(IDB_VAULT_STORE).put(generated, IDB_MASTER_KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return generated;
  } catch {
    db.close();
    return null;
  }
}

async function clearIdbMasterKey(): Promise<void> {
  const db = await openVaultIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_VAULT_STORE, "readwrite");
    tx.objectStore(IDB_VAULT_STORE).delete(IDB_MASTER_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function wrapDekWithPin(dekBytes: Uint8Array, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await derivePinKek(pin, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    dekBytes as BufferSource,
  );
  return {
    pinSaltB64: toB64(salt),
    pinIvB64: toB64(iv),
    pinWrappedDekB64: toB64(new Uint8Array(ctBuf)),
  };
}

async function unwrapDekWithPin(meta: LedgerVaultMeta, pin: string): Promise<Uint8Array> {
  const salt = fromB64(meta.pinSaltB64);
  const iv = fromB64(meta.pinIvB64);
  const wrapped = fromB64(meta.pinWrappedDekB64);
  const kek = await derivePinKek(pin, salt);
  const rawBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    kek,
    wrapped as BufferSource,
  );
  return new Uint8Array(rawBuf);
}

async function hydrateDecryptedMemCacheFromStorage(key: CryptoKey, storage: Storage): Promise<void> {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && isLedgerKeyName(k)) keys.push(k);
  }

  for (const k of keys) {
    const raw = storage.getItem(k);
    if (!raw) continue;
    if (isEncryptedLedgerEnvelope(raw)) {
      const env = JSON.parse(raw) as EncryptedLedgerEnvelope;
      const plain = await decryptEnvelopeWithKey(key, env);
      decryptedLedgerMemCache.set(k, plain);
    } else {
      // Plaintext remnant — migrate into encrypted storage immediately
      decryptedLedgerMemCache.set(k, raw);
      const env = await encryptStringWithKey(key, raw);
      storage.setItem(k, JSON.stringify(env));
    }
  }
}

export async function enableLedgerEncryption(
  mode: Exclude<LedgerEncryptionMode, "off">,
  pin: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): Promise<void> {
  if (!storage) throw new Error("Storage unavailable");
  if (!pin || pin.trim().length < 4) throw new Error("أدخل رمز PIN صالحاً لتفعيل التشفير");

  let dekBytes = activeDekBytes;
  const existingMeta = loadVaultMeta(storage);
  if (!dekBytes && existingMeta) {
    dekBytes = await unwrapDekWithPin(existingMeta, pin);
  }
  if (!dekBytes) {
    dekBytes = crypto.getRandomValues(new Uint8Array(32));
  }

  const dataKey = await importDataKey(dekBytes);
  const pinWrap = await wrapDekWithPin(dekBytes, pin);

  let keystoreSealedDek: string | undefined;
  let idbWrappedIvB64: string | undefined;
  let idbWrappedDekB64: string | undefined;

  if (mode === "biometric") {
    const dekB64 = toB64(dekBytes);
    if (typeof window !== "undefined") {
      try {
        const sealed = (window as NativeVaultWindow).MizanNative?.sealWithKeystore?.(dekB64);
        if (sealed && sealed.includes(".")) {
          keystoreSealedDek = sealed;
        }
      } catch {
        /* ignore native bridge errors */
      }
    }
    if (!keystoreSealedDek) {
      const idbMaster = await getOrCreateIdbMasterKey();
      if (idbMaster) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const wrapped = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          idbMaster,
          dekBytes as BufferSource,
        );
        idbWrappedIvB64 = toB64(iv);
        idbWrappedDekB64 = toB64(new Uint8Array(wrapped));
      }
    }
  } else {
    await clearIdbMasterKey();
    if (typeof window !== "undefined") {
      try {
        (window as NativeVaultWindow).MizanNative?.clearVaultSession?.();
      } catch {
        /* ignore */
      }
    }
  }

  const meta: LedgerVaultMeta = {
    v: 1,
    mode,
    ...pinWrap,
    keystoreSealedDek,
    idbWrappedIvB64,
    idbWrappedDekB64,
    updatedAt: Date.now(),
  };

  activeDekBytes = new Uint8Array(dekBytes);
  activeDataKey = dataKey;

  // Encrypt all ledger snapshots in storage with AES-256-GCM
  const ledgerKeys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && isLedgerKeyName(k)) ledgerKeys.push(k);
  }
  for (const k of ledgerKeys) {
    const currentPlain =
      decryptedLedgerMemCache.get(k) ??
      (() => {
        const raw = storage.getItem(k);
        if (!raw || isEncryptedLedgerEnvelope(raw)) return null;
        return raw;
      })();
    if (currentPlain !== null) {
      decryptedLedgerMemCache.set(k, currentPlain);
      const env = await encryptStringWithKey(dataKey, currentPlain);
      storage.setItem(k, JSON.stringify(env));
    }
  }

  storage.setItem(LEDGER_VAULT_META_KEY, JSON.stringify(meta));
}

export async function unlockLedgerWithPin(
  pin: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): Promise<boolean> {
  if (!storage) return false;
  const meta = loadVaultMeta(storage);
  if (!meta) return true;
  try {
    const dekBytes = await unwrapDekWithPin(meta, pin);
    const dataKey = await importDataKey(dekBytes);
    activeDekBytes = dekBytes;
    activeDataKey = dataKey;
    await hydrateDecryptedMemCacheFromStorage(dataKey, storage);
    return true;
  } catch {
    return false;
  }
}

export async function unlockLedgerWithBiometric(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): Promise<boolean> {
  if (!storage) return false;
  const meta = loadVaultMeta(storage);
  if (!meta) return true;
  if (meta.mode === "strict_pin") return false;

  try {
    let dekBytes: Uint8Array | null = null;
    if (meta.keystoreSealedDek && typeof window !== "undefined") {
      const unsealed = (window as NativeVaultWindow).MizanNative?.unsealWithKeystore?.(
        meta.keystoreSealedDek,
      );
      if (unsealed) {
        dekBytes = fromB64(unsealed);
      }
    }
    if (!dekBytes && meta.idbWrappedDekB64 && meta.idbWrappedIvB64) {
      const idbMaster = await getOrCreateIdbMasterKey();
      if (idbMaster) {
        const iv = fromB64(meta.idbWrappedIvB64);
        const ct = fromB64(meta.idbWrappedDekB64);
        const buf = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          idbMaster,
          ct as BufferSource,
        );
        dekBytes = new Uint8Array(buf);
      }
    }
    if (!dekBytes) return false;
    const dataKey = await importDataKey(dekBytes);
    activeDekBytes = dekBytes;
    activeDataKey = dataKey;
    await hydrateDecryptedMemCacheFromStorage(dataKey, storage);
    return true;
  } catch {
    return false;
  }
}

export async function disableLedgerEncryption(
  pin: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): Promise<void> {
  if (!storage) return;
  const meta = loadVaultMeta(storage);
  if (!meta) return;

  const dekBytes = await unwrapDekWithPin(meta, pin);
  const dataKey = await importDataKey(dekBytes);

  const ledgerKeys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && isLedgerKeyName(k)) ledgerKeys.push(k);
  }

  for (const k of ledgerKeys) {
    const cached = decryptedLedgerMemCache.get(k);
    if (cached) {
      storage.setItem(k, cached);
      continue;
    }
    const raw = storage.getItem(k);
    if (raw && isEncryptedLedgerEnvelope(raw)) {
      const plain = await decryptEnvelopeWithKey(dataKey, JSON.parse(raw) as EncryptedLedgerEnvelope);
      storage.setItem(k, plain);
    }
  }

  storage.removeItem(LEDGER_VAULT_META_KEY);
  decryptedLedgerMemCache.clear();
  activeDekBytes = null;
  activeDataKey = null;
  await clearIdbMasterKey();
  if (typeof window !== "undefined") {
    try {
      (window as NativeVaultWindow).MizanNative?.clearVaultSession?.();
    } catch {
      /* ignore */
    }
  }
}

export async function rewrapLedgerKeyForNewPin(
  newPin: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): Promise<boolean> {
  if (!storage || !activeDekBytes) return false;
  const meta = loadVaultMeta(storage);
  if (!meta) return true;
  const pinWrap = await wrapDekWithPin(activeDekBytes, newPin);
  const updated: LedgerVaultMeta = {
    ...meta,
    ...pinWrap,
    updatedAt: Date.now(),
  };
  storage.setItem(LEDGER_VAULT_META_KEY, JSON.stringify(updated));
  return true;
}

export function lockLedgerMemorySession(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (typeof window !== "undefined") {
    try {
      (window as NativeVaultWindow).MizanNative?.clearVaultSession?.();
    } catch {
      /* ignore */
    }
  }
  const mode = getLedgerEncryptionMode(storage);
  if (mode === "strict_pin") {
    if (activeDekBytes) activeDekBytes.fill(0);
    activeDekBytes = null;
    activeDataKey = null;
    decryptedLedgerMemCache.clear();
  }
}

export function resetLedgerCryptoForTests(): void {
  if (activeDekBytes) activeDekBytes.fill(0);
  activeDekBytes = null;
  activeDataKey = null;
  decryptedLedgerMemCache.clear();
  writeSeqByKey.clear();
}

export function readLedgerStorageItem(
  key: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): string | null {
  if (!storage) return null;
  const mode = getLedgerEncryptionMode(storage);
  if (mode === "off") {
    return storage.getItem(key);
  }
  if (decryptedLedgerMemCache.has(key)) {
    return decryptedLedgerMemCache.get(key) ?? null;
  }
  const raw = storage.getItem(key);
  if (!raw || isEncryptedLedgerEnvelope(raw)) {
    return null;
  }
  return raw;
}

export function writeLedgerStorageItem(
  key: string,
  plainJson: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  const mode = getLedgerEncryptionMode(storage);
  if (mode === "off") {
    storage.setItem(key, plainJson);
    return;
  }
  decryptedLedgerMemCache.set(key, plainJson);
  const keyRef = activeDataKey;
  if (!keyRef) {
    // Vault not yet unlocked (e.g. cold boot before PIN entry): NEVER overwrite encrypted disk data with seed/plaintext!
    return;
  }
  const nextSeq = (writeSeqByKey.get(key) ?? 0) + 1;
  writeSeqByKey.set(key, nextSeq);
  void encryptStringWithKey(keyRef, plainJson)
    .then((env) => {
      if (writeSeqByKey.get(key) === nextSeq && getLedgerEncryptionMode(storage) !== "off") {
        storage.setItem(key, JSON.stringify(env));
      }
    })
    .catch(() => undefined);
}
