import assert from "node:assert/strict";
import test from "node:test";
import {
  disableLedgerEncryption,
  enableLedgerEncryption,
  getLedgerEncryptionMode,
  isEncryptedLedgerEnvelope,
  lockLedgerMemorySession,
  readLedgerStorageItem,
  requiresStrictPinColdUnlock,
  resetLedgerCryptoForTests,
  rewrapLedgerKeyForNewPin,
  unlockLedgerWithBiometric,
  unlockLedgerWithPin,
  writeLedgerStorageItem,
} from "./ledger-crypto.ts";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

test("Dual-mode AES-256-GCM ledger encryption: strict_pin enforces PIN-only cold boot and never leaks or overwrites ciphertext", async () => {
  resetLedgerCryptoForTests();
  const storage = makeMemoryStorage();
  const secretJson = JSON.stringify({ openingBalance: 987654, note: "رصيد سري للغاية" });
  storage.setItem("mizan.tenant.t-sec.v1", secretJson);

  await enableLedgerEncryption("strict_pin", "2580", storage);
  assert.equal(getLedgerEncryptionMode(storage), "strict_pin");

  const rawOnDisk = storage.getItem("mizan.tenant.t-sec.v1")!;
  assert.equal(isEncryptedLedgerEnvelope(rawOnDisk), true);
  assert.equal(rawOnDisk.includes("987654"), false);
  assert.equal(rawOnDisk.includes("رصيد سري"), false);

  // Simulate cold boot / lock: strict_pin wipes key from RAM
  lockLedgerMemorySession(storage);
  assert.equal(requiresStrictPinColdUnlock(storage), true);
  assert.equal(readLedgerStorageItem("mizan.tenant.t-sec.v1", storage), null);

  // Attempting to write seed fallback while locked MUST NOT overwrite ciphertext on disk!
  writeLedgerStorageItem("mizan.tenant.t-sec.v1", JSON.stringify({ openingBalance: 0 }), storage);
  assert.equal(storage.getItem("mizan.tenant.t-sec.v1"), rawOnDisk);

  // Biometric unlock is strictly refused in strict_pin mode
  assert.equal(await unlockLedgerWithBiometric(storage), false);
  // Wrong PIN is refused
  assert.equal(await unlockLedgerWithPin("0000", storage), false);

  // Correct PIN derives KEK via PBKDF2-SHA256 and decrypts vault into memory
  assert.equal(await unlockLedgerWithPin("2580", storage), true);
  assert.equal(requiresStrictPinColdUnlock(storage), false);
  assert.equal(readLedgerStorageItem("mizan.tenant.t-sec.v1", storage), secretJson);
});

test("Dual-mode AES-256-GCM ledger encryption: biometric mode supports Keystore unseal, PIN rotation, and clean disable", async () => {
  resetLedgerCryptoForTests();
  const storage = makeMemoryStorage();
  const secretJson = JSON.stringify({ openingBalance: 42000, owner: "محمود" });
  storage.setItem("mizan.v1", secretJson);

  const g = globalThis as unknown as {
    window?: {
      MizanNative?: {
        sealWithKeystore?: (pt: string) => string;
        unsealWithKeystore?: (ct: string) => string;
        clearVaultSession?: () => boolean;
      };
    };
  };
  const prevWin = g.window;
  let sessionVerified = true;
  g.window = {
    MizanNative: {
      sealWithKeystore: (pt: string) => `ivmock.${Buffer.from(pt, "utf8").toString("base64")}`,
      unsealWithKeystore: (ct: string) => {
        if (!sessionVerified) return "";
        const b64 = ct.split(".")[1] ?? "";
        return Buffer.from(b64, "base64").toString("utf8");
      },
      clearVaultSession: () => {
        sessionVerified = false;
        return true;
      },
    },
  };

  try {
    await enableLedgerEncryption("biometric", "1357", storage);
    assert.equal(getLedgerEncryptionMode(storage), "biometric");
    assert.equal(isEncryptedLedgerEnvelope(storage.getItem("mizan.v1")), true);

    // Cold boot reset + biometric hardware auth succeeds -> unlocks without PIN!
    resetLedgerCryptoForTests();
    sessionVerified = true;
    assert.equal(await unlockLedgerWithBiometric(storage), true);
    assert.equal(readLedgerStorageItem("mizan.v1", storage), secretJson);

    // Rotate PIN to 9911 and verify new PIN works
    assert.equal(await rewrapLedgerKeyForNewPin("9911", storage), true);
    resetLedgerCryptoForTests();
    assert.equal(await unlockLedgerWithPin("1357", storage), false);
    assert.equal(await unlockLedgerWithPin("9911", storage), true);

    // Disable encryption restores plaintext JSON cleanly
    await disableLedgerEncryption("9911", storage);
    assert.equal(getLedgerEncryptionMode(storage), "off");
    assert.equal(storage.getItem("mizan.v1"), secretJson);
  } finally {
    g.window = prevWin;
    resetLedgerCryptoForTests();
  }
});
