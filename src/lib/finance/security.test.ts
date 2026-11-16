import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SECURITY_SETTINGS,
  NATIVE_BIOMETRIC_CREDENTIAL_ID,
  isBiometricSupported,
  loadSecuritySettings,
  saveSecuritySettings,
  shouldAutoLock,
  verifyBiometricCredential,
} from "./security.ts";

type FakeWindow = Record<string, unknown>;

function setWindow(value: FakeWindow | undefined) {
  const g = globalThis as Record<string, unknown>;
  if (value === undefined) delete g.window;
  else g.window = value;
}

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Storage;
}

test("the native bridge decides biometric availability before WebAuthn is considered", async () => {
  try {
    setWindow({ MizanNative: { biometricAvailable: () => true } });
    assert.equal(await isBiometricSupported(), true);

    // A vendor sensor that throws must degrade to "unavailable", never crash the
    // security screen.
    setWindow({
      MizanNative: {
        biometricAvailable: () => {
          throw new Error("sensor exploded");
        },
      },
    });
    assert.equal(await isBiometricSupported(), false);

    setWindow({ MizanNative: { biometricAvailable: () => false } });
    assert.equal(await isBiometricSupported(), false);
  } finally {
    setWindow(undefined);
  }

  // Plain Node has no WebAuthn and no bridge, so the answer must be a clean false.
  assert.equal(await isBiometricSupported(), false);
});

test("a native prompt unlocks only on an explicit success result", async () => {
  const ids: string[] = [];
  try {
    setWindow({
      MizanNative: {
        authenticateBiometric: (requestId: string) => {
          ids.push(requestId);
          return true;
        },
      },
    });

    const w = () => globalThis as unknown as { window: FakeWindow };
    const handlerOf = () => {
      const cb = w().window.__mizanBiometric;
      assert.equal(typeof cb, "function", "the result channel must be installed");
      return cb as (requestId: string, ok: boolean, code?: string) => void;
    };

    const rejected = verifyBiometricCredential(NATIVE_BIOMETRIC_CREDENTIAL_ID);
    handlerOf()(ids[0]!, false, "error_10");
    assert.equal(await rejected, false, "a cancelled prompt must not unlock");

    const accepted = verifyBiometricCredential(NATIVE_BIOMETRIC_CREDENTIAL_ID);
    handlerOf()(ids[1]!, true, "ok");
    assert.equal(await accepted, true);

    // Each attempt gets its own request id, so a stale callback cannot settle a
    // newer prompt.
    assert.notEqual(ids[0], ids[1]);
  } finally {
    setWindow(undefined);
  }
});

test("a refused or missing native prompt fails closed", async () => {
  try {
    setWindow({ MizanNative: { authenticateBiometric: () => false } });
    assert.equal(await verifyBiometricCredential(NATIVE_BIOMETRIC_CREDENTIAL_ID), false);
  } finally {
    setWindow(undefined);
  }

  // No bridge and no WebAuthn: the sentinel must never silently fall through to
  // another mechanism.
  assert.equal(await verifyBiometricCredential(NATIVE_BIOMETRIC_CREDENTIAL_ID), false);
  assert.equal(await verifyBiometricCredential(""), false);
});

test("auto-lock only fires when a PIN exists and the timeout has elapsed", () => {
  const now = 1_000_000;
  assert.equal(shouldAutoLock(now - 999_999, now, 5, false), false, "no PIN means no lock");
  assert.equal(shouldAutoLock(now - 999_999, now, -1, true), false, "timeout -1 disables locking");
  assert.equal(shouldAutoLock(now, now, 0, true), true, "timeout 0 locks immediately");
  assert.equal(shouldAutoLock(now - 4 * 60_000, now, 5, true), false);
  assert.equal(shouldAutoLock(now - 5 * 60_000, now, 5, true), true);
});

test("stored security settings are normalised instead of trusted", () => {
  assert.deepEqual(loadSecuritySettings(undefined), DEFAULT_SECURITY_SETTINGS);

  const storage = fakeStorage({
    "mizan.security.v1": JSON.stringify({
      autoLockMinutes: 99,
      biometricEnabled: "yes",
      biometricCredentialId: 42,
      hideBalancesInRecents: false,
    }),
  });
  const loaded = loadSecuritySettings(storage);
  assert.equal(loaded.autoLockMinutes, 5, "unknown timeouts fall back to the default");
  assert.equal(loaded.biometricEnabled, true);
  assert.equal(loaded.biometricCredentialId, undefined, "non-string credential ids are dropped");
  assert.equal(loaded.hideBalancesInRecents, false);

  const written = saveSecuritySettings({ ...DEFAULT_SECURITY_SETTINGS, autoLockMinutes: 1 }, storage);
  assert.equal(written.autoLockMinutes, 1);
  assert.equal(loadSecuritySettings(storage).autoLockMinutes, 1);
});
