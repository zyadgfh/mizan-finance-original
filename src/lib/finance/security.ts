import { useSyncExternalStore } from "react";

export const SECURITY_STORAGE_KEY = "mizan.security.v1";

export type AutoLockTimeout = -1 | 0 | 1 | 5 | 15;

export type SecuritySettings = {
  autoLockMinutes: AutoLockTimeout;
  biometricEnabled: boolean;
  biometricCredentialId?: string;
  hideBalancesInRecents: boolean;
  hideAmounts: boolean;
  hidePeopleNames: boolean;
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  autoLockMinutes: 5,
  biometricEnabled: false,
  hideBalancesInRecents: true,
  hideAmounts: false,
  hidePeopleNames: false,
};

const VALID_TIMEOUTS = new Set<number>([-1, 0, 1, 5, 15]);
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSnapshot: SecuritySettings = DEFAULT_SECURITY_SETTINGS;

function normalizeSecuritySettings(raw: Partial<SecuritySettings> | null | undefined): SecuritySettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SECURITY_SETTINGS;
  const timeout = Number(raw.autoLockMinutes);
  return {
    autoLockMinutes: VALID_TIMEOUTS.has(timeout) ? (timeout as AutoLockTimeout) : 5,
    biometricEnabled: Boolean(raw.biometricEnabled),
    biometricCredentialId:
      typeof raw.biometricCredentialId === "string" && raw.biometricCredentialId
        ? raw.biometricCredentialId
        : undefined,
    hideBalancesInRecents: raw.hideBalancesInRecents !== false,
    hideAmounts: Boolean(raw.hideAmounts),
    hidePeopleNames: Boolean(raw.hidePeopleNames),
  };
}

export function loadSecuritySettings(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): SecuritySettings {
  try {
    const raw = storage?.getItem(SECURITY_STORAGE_KEY) ?? null;
    if (!raw) return DEFAULT_SECURITY_SETTINGS;
    return normalizeSecuritySettings(JSON.parse(raw) as Partial<SecuritySettings>);
  } catch {
    return DEFAULT_SECURITY_SETTINGS;
  }
}

function getClientSnapshot(): SecuritySettings {
  if (typeof localStorage === "undefined") return DEFAULT_SECURITY_SETTINGS;
  const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = loadSecuritySettings(localStorage);
  }
  return cachedSnapshot;
}

const getServerSnapshot = () => DEFAULT_SECURITY_SETTINGS;

export function saveSecuritySettings(
  next: SecuritySettings,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): SecuritySettings {
  const normalized = normalizeSecuritySettings(next);
  const serialized = JSON.stringify(normalized);
  try {
    storage?.setItem(SECURITY_STORAGE_KEY, serialized);
  } catch {
    /* ignore storage unavailable */
  }
  if (storage === undefined || (typeof localStorage !== "undefined" && storage === localStorage)) {
    cachedRaw = serialized;
    cachedSnapshot = normalized;
    applyPrivacyScreenFlag(normalized.hideBalancesInRecents);
    for (const listener of listeners) listener();
  }
  return normalized;
}

export function updateSecuritySettings(
  patch: Partial<SecuritySettings>,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): SecuritySettings {
  return saveSecuritySettings({ ...loadSecuritySettings(storage), ...patch }, storage);
}

export function subscribeSecuritySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSecuritySettings(): SecuritySettings {
  return useSyncExternalStore(subscribeSecuritySettings, getClientSnapshot, getServerSnapshot);
}

export function applyPrivacyScreenFlag(hideInRecents: boolean): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (
    window as Window & { MizanNative?: { setScreenSecure?: (enabled: boolean) => boolean } }
  ).MizanNative;
  if (bridge?.setScreenSecure) {
    try {
      return Boolean(bridge.setScreenSecure(hideInRecents));
    } catch {
      return false;
    }
  }
  return false;
}

export function maskPersonName(name: string, hide: boolean): string {
  if (!hide) return name;
  const trimmed = name.trim();
  if (!trimmed) return "••••";
  return `${trimmed.slice(0, 1)}•••`;
}

export function shouldAutoLock(
  lastActiveAt: number,
  now: number,
  timeoutMinutes: AutoLockTimeout,
  pinEnabled: boolean,
): boolean {
  if (!pinEnabled || timeoutMinutes < 0) return false;
  if (timeoutMinutes === 0) return true;
  return now - lastActiveAt >= timeoutMinutes * 60_000;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function isBiometricSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window) || !navigator.credentials) {
    return false;
  }
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch {
    return false;
  }
}

export async function registerBiometricCredential(): Promise<string> {
  if (!(await isBiometricSupported())) {
    throw new Error("المصادقة الحيوية غير متاحة على هذا الجهاز");
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "ميزان", id: window.location.hostname || "localhost" },
      user: { id: userId, name: "mizan-local", displayName: "دفتر ميزان" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!cred?.rawId) throw new Error("لم يكتمل تسجيل البصمة");
  return toBase64Url(new Uint8Array(cred.rawId));
}

export async function verifyBiometricCredential(credentialId: string): Promise<boolean> {
  if (!credentialId || !(await isBiometricSupported())) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const idBytes = fromBase64Url(credentialId);
    const idBuffer = idBytes.buffer.slice(idBytes.byteOffset, idBytes.byteOffset + idBytes.byteLength) as ArrayBuffer;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: "public-key", id: idBuffer }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return Boolean(assertion);
  } catch {
    return false;
  }
}

export const MIZAN_LOCAL_STORAGE_KEYS = [
  "mizan.v1",
  "mizan.updatedAt",
  "mizan.pin",
  "mizan.security.v1",
  "mizan.ui-prefs.v1",
  "mizan.error-log.v1",
  "mizan.perf.v1",
  "mizan.entry-prefs.v1",
  "mizan.scheduled-tasks.v1",
  "mizan.drive.clientId",
  "mizan.drive.prefs",
  "mizan.drive.enc",
] as const;

export function overwriteAndClearLocalKeys(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  const zeroPad = "0".repeat(256);
  for (const key of MIZAN_LOCAL_STORAGE_KEYS) {
    try {
      if (storage.getItem(key) !== null) {
        storage.setItem(key, zeroPad);
        storage.removeItem(key);
      }
    } catch {
      /* ignore individual key removal failures */
    }
  }
}
