import { useSyncExternalStore } from "react";
import { resetLedgerCryptoForTests } from "./ledger-crypto.ts";

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

/**
 * Native app-lock bridge (Android APK).
 *
 * The Capacitor WebView does not implement WebAuthn: `navigator.credentials` is
 * absent or `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 * reports false, which made the fingerprint switch look "unsupported" inside the
 * APK while working in Chrome. MainActivity now exposes the platform
 * BiometricPrompt through the same JS bridge as sharing and FLAG_SECURE, behind
 * the identical trusted-origin check.
 */
type NativeBiometricBridge = {
  biometricAvailable?: () => boolean;
  authenticateBiometric?: (requestId: string) => boolean;
};

/**
 * Stored in place of a WebAuthn credential id when the OS owns the biometric.
 * The secret never leaves the secure hardware, so there is nothing for us to
 * persist beyond the fact that the user turned the feature on.
 */
export const NATIVE_BIOMETRIC_CREDENTIAL_ID = "native:biometric";

/** A pending OS prompt is abandoned after this long so the UI never freezes. */
const BIOMETRIC_TIMEOUT_MS = 90_000;

type BiometricWindow = Window & {
  MizanNative?: NativeBiometricBridge;
  __mizanBiometric?: (requestId: string, ok: boolean, code?: string) => void;
};

function nativeBiometricBridge(): NativeBiometricBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as BiometricWindow).MizanNative;
  if (!bridge || typeof bridge !== "object") return null;
  if (typeof bridge.biometricAvailable !== "function" && typeof bridge.authenticateBiometric !== "function") {
    return null;
  }
  return bridge;
}

const pendingNativePrompts = new Map<string, (ok: boolean) => void>();

function installNativeResultHandler(): void {
  if (typeof window === "undefined") return;
  const w = window as BiometricWindow;
  if (typeof w.__mizanBiometric === "function") return;
  w.__mizanBiometric = (requestId: string, ok: boolean) => {
    const settle = pendingNativePrompts.get(requestId);
    if (!settle) return;
    pendingNativePrompts.delete(requestId);
    // Only the explicit success branch unlocks; cancellations, lockouts and
    // sensor errors all arrive here as ok === false.
    settle(ok === true);
  };
}

/**
 * Runs one OS biometric prompt and resolves to whether it succeeded.
 *
 * Fails closed: no bridge, a refused request (prompt already open), an
 * untrusted origin or a timeout all resolve to false.
 */
export async function requestNativeBiometricUnlock(): Promise<boolean> {
  const bridge = nativeBiometricBridge();
  if (!bridge || typeof bridge.authenticateBiometric !== "function") return false;
  installNativeResultHandler();

  const requestId = `bio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutRef: { id?: ReturnType<typeof setTimeout> } = {};
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      pendingNativePrompts.delete(requestId);
      if (timeoutRef.id !== undefined) clearTimeout(timeoutRef.id);
      resolve(ok);
    };

    pendingNativePrompts.set(requestId, settle);
    timeoutRef.id = setTimeout(() => settle(false), BIOMETRIC_TIMEOUT_MS);

    let started = false;
    try {
      started = Boolean(bridge.authenticateBiometric?.(requestId));
    } catch {
      started = false;
    }
    if (!started) settle(false);
  });
}

export async function isBiometricSupported(): Promise<boolean> {
  const bridge = nativeBiometricBridge();
  if (bridge) {
    // A bridge without the availability probe still means a native prompt
    // exists; let the prompt itself be the authority.
    if (typeof bridge.biometricAvailable !== "function") return true;
    try {
      return Boolean(bridge.biometricAvailable());
    } catch {
      return false;
    }
  }

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
  const bridge = nativeBiometricBridge();
  if (bridge && typeof bridge.authenticateBiometric === "function") {
    // Prove the sensor actually answers before the user relies on it, so they
    // cannot end up locked out with a switch that is on but does nothing.
    const ok = await requestNativeBiometricUnlock();
    if (!ok) throw new Error("لم يكتمل التحقق من البصمة — أعد المحاولة");
    return NATIVE_BIOMETRIC_CREDENTIAL_ID;
  }

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
  if (!credentialId) return false;

  if (credentialId === NATIVE_BIOMETRIC_CREDENTIAL_ID) {
    // Never fall through to WebAuthn for the sentinel: a device that recorded a
    // native credential must unlock through the OS prompt only.
    return requestNativeBiometricUnlock();
  }

  if (!(await isBiometricSupported())) return false;
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
  "mizan.ledgerVault.v1",
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
  resetLedgerCryptoForTests();
  if (!storage) return;
  const zeroPad = "0".repeat(256);
  const dynamicKeys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (!k) continue;
    if (
      k.startsWith("mizan.tenant.") ||
      k.startsWith("mizan.user.") ||
      k.startsWith("mizan.auth.") ||
      k.startsWith("mizan.zakat.") ||
      k === "mizan.migratedToTenant.v1" ||
      k === "mizan.supabase.auth.v1"
    ) {
      dynamicKeys.push(k);
    }
  }
  const allKeys = [...new Set([...MIZAN_LOCAL_STORAGE_KEYS, ...dynamicKeys])];
  for (const key of allKeys) {
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
