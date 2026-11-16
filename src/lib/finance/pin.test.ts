import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPinFailures,
  hashPin,
  pinLockoutRemainingMs,
  readPinHash,
  recordPinFailure,
  verifyPin,
  writePinHash,
} from "./pin.ts";

test("PIN hashes use a salted PBKDF2 record, never a bare SHA-256 digest", async () => {
  const stored = await hashPin("1234");
  const record = JSON.parse(stored) as Record<string, unknown>;

  assert.equal(record.v, 2);
  assert.equal(record.alg, "PBKDF2-SHA256");
  assert.ok(Number(record.iterations) >= 100_000);
  assert.match(String(record.salt), /^[0-9a-f]{32}$/);
  assert.match(String(record.hash), /^[0-9a-f]{64}$/);
  assert.ok(!/^[0-9a-f]{64}$/.test(stored), "record must not be a plain digest");

  // Same PIN + different salt => different hash (no rainbow-table reuse).
  const other = JSON.parse(await hashPin("1234")) as Record<string, unknown>;
  assert.notEqual(other.salt, record.salt);
  assert.notEqual(other.hash, record.hash);
});

test("verifyPin accepts the right PIN and rejects the wrong one", async () => {
  const stored = await hashPin("4242");
  assert.equal((await verifyPin("4242", stored)).ok, true);
  assert.equal((await verifyPin("4243", stored)).ok, false);
  assert.equal((await verifyPin("", stored)).ok, false);
  assert.equal((await verifyPin("4242", null)).ok, false);
});

test("legacy SHA-256 PIN records still verify and get upgraded", async () => {
  const legacyInput = new TextEncoder().encode("mizan.pin.v1:9876");
  const digest = await crypto.subtle.digest("SHA-256", legacyInput);
  const legacyHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const result = await verifyPin("9876", legacyHash);
  assert.equal(result.ok, true);
  assert.ok(result.upgraded, "legacy record should be upgraded to the KDF format");

  const upgraded = JSON.parse(result.upgraded as string) as Record<string, unknown>;
  assert.equal(upgraded.v, 2);
  assert.equal((await verifyPin("9876", result.upgraded)).ok, true);
  assert.equal((await verifyPin("0000", legacyHash)).ok, false);
});

test("tampered / hostile PIN records are rejected without hanging", async () => {
  const hostileIterations = JSON.stringify({
    v: 2,
    alg: "PBKDF2-SHA256",
    iterations: 500_000_000,
    salt: "a".repeat(32),
    hash: "b".repeat(64),
  });
  const started = Date.now();
  const result = await verifyPin("1234", hostileIterations);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 2_000, "must not run an attacker-chosen iteration count");

  const shortSalt = JSON.stringify({
    v: 2,
    alg: "PBKDF2-SHA256",
    iterations: 210_000,
    salt: "aabb",
    hash: "b".repeat(64),
  });
  assert.equal((await verifyPin("1234", shortSalt)).ok, false);
  assert.equal((await verifyPin("1234", "{not json")).ok, false);
});

test("PIN guess throttling backs off and resets on success", () => {
  writePinHash(null);
  clearPinFailures();
  assert.equal(pinLockoutRemainingMs(), 0);

  recordPinFailure();
  recordPinFailure();
  recordPinFailure();
  assert.equal(pinLockoutRemainingMs(), 0, "first guesses stay free");

  recordPinFailure();
  assert.ok(pinLockoutRemainingMs() > 0, "fourth failure introduces a delay");
  assert.ok(recordPinFailure() > 0);

  clearPinFailures();
  assert.equal(pinLockoutRemainingMs(), 0);
  assert.equal(readPinHash(), null);
});
