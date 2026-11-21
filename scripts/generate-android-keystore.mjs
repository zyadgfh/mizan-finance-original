#!/usr/bin/env node
/**
 * Generates a persistent 27-year PKCS12 Android release keystore (`.mizan-release.p12`, gitignored)
 * and prints the 4 GitHub Repository Secrets needed by `.github/workflows/android-apk.yml`
 * so every future APK release upgrades seamlessly in-place without uninstalling the old version.
 *
 * Usage:
 *   npm run keystore:gen
 *   npm run keystore:gen -- --apply-gh   # also sets secrets via `gh secret set` on your machine
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const keystorePath = resolve(process.cwd(), ".mizan-release.p12");
const secretsPreviewPath = resolve(process.cwd(), ".keystore-secrets.env");
const alias = "mizan";
const password = randomBytes(24).toString("hex");
const applyGh = process.argv.includes("--apply-gh");

if (existsSync(keystorePath)) {
  console.error(
    `[keystore:gen] Keystore already exists at ${keystorePath}.\nDelete or move it first if you intentionally want to rotate keys.`,
  );
  process.exit(1);
}

execFileSync(
  "keytool",
  [
    "-genkeypair",
    "-v",
    "-keystore",
    keystorePath,
    "-storetype",
    "PKCS12",
    "-alias",
    alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
    "-storepass",
    password,
    "-keypass",
    password,
    "-dname",
    "CN=Mizan Finance, OU=Mobile, O=Mizan, C=EG",
  ],
  { stdio: "inherit" },
);

const b64 = readFileSync(keystorePath).toString("base64");
const envContent = [
  `ANDROID_KEYSTORE_BASE64=${b64}`,
  `ANDROID_KEYSTORE_PASSWORD=${password}`,
  `ANDROID_KEY_ALIAS=${alias}`,
  `ANDROID_KEY_PASSWORD=${password}`,
  "",
].join("\n");

writeFileSync(secretsPreviewPath, envContent, { mode: 0o600 });

console.log("\n✅ Persistent Android Keystore generated successfully!");
console.log(`   Keystore binary (keep a safe backup!): ${keystorePath}`);
console.log(`   GitHub Secrets file (gitignored):      ${secretsPreviewPath}\n`);

if (applyGh) {
  console.log("Applying secrets to GitHub repository via `gh secret set`...");
  const secrets = {
    ANDROID_KEYSTORE_BASE64: b64,
    ANDROID_KEYSTORE_PASSWORD: password,
    ANDROID_KEY_ALIAS: alias,
    ANDROID_KEY_PASSWORD: password,
  };
  for (const [name, value] of Object.entries(secrets)) {
    execFileSync("gh", ["secret", "set", name, "--body", value], { stdio: "inherit" });
  }
  console.log("✅ All 4 Android signing secrets uploaded to GitHub Actions!");
} else {
  console.log("To upload all 4 secrets automatically from your local terminal, run:");
  console.log("  gh secret set -f .keystore-secrets.env\n");
}
