import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  validateBackupJsonObject,
} from "./crypto-backup.ts";

const PASSPHRASE = "correct horse battery staple";

test("encrypted backups round-trip", async () => {
  const payload = JSON.stringify({ txns: [], people: [], debts: [], payments: [], categories: [] });
  const envelope = await encryptBackupPayload(payload, PASSPHRASE);

  assert.equal(isEncryptedBackupEnvelope(envelope), true);
  assert.equal(envelope.alg, "AES-GCM");
  assert.equal(await decryptBackupPayload(envelope, PASSPHRASE), payload);
  await assert.rejects(() => decryptBackupPayload(envelope, "wrong passphrase"));
});

test("hostile iteration counts are rejected instead of freezing the device", () => {
  const envelope = {
    encrypted: true,
    version: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 1_000_000_000,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    iv: "AAAAAAAAAAAAAAAA",
    ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  assert.equal(isEncryptedBackupEnvelope(envelope), false);
  const started = Date.now();
  assert.rejects(() => decryptBackupPayload(envelope as never, PASSPHRASE));
  assert.ok(Date.now() - started < 1_000, "rejection happens before any KDF work");
});

test("unknown versions, algorithms and malformed base64 are rejected", async () => {
  const good = await encryptBackupPayload("{}", PASSPHRASE);
  const variants = [
    { ...good, version: 2 },
    { ...good, alg: "AES-CBC" },
    { ...good, kdf: "scrypt" },
    { ...good, iterations: 1_000 },
    { ...good, salt: "short" },
    { ...good, salt: "!!!not-base64!!!" },
    { ...good, iv: "AAAA" },
    { ...good, ciphertext: "" },
    { ...good, ciphertext: "AAAA" },
  ];
  for (const variant of variants) {
    assert.equal(isEncryptedBackupEnvelope(variant), false, JSON.stringify(variant).slice(0, 80));
    await assert.rejects(() => decryptBackupPayload(variant as never, PASSPHRASE));
  }
});

test("backup JSON validation rejects oversized tables", () => {
  const rows = Array.from({ length: 200_001 }, (_, i) => ({ id: String(i) }));
  const result = validateBackupJsonObject({
    txns: rows,
    people: [],
    debts: [],
    payments: [],
    categories: [],
  });
  assert.equal(result.ok, false);
});
