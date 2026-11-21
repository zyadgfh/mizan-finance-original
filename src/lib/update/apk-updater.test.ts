import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSemver,
  evaluateGithubRelease,
  extractCleanReleaseNotes,
  FALLBACK_APK_DOWNLOAD_URL,
  isCriticalRelease,
} from "./apk-updater.ts";

test("compareSemver compares release versions accurately", () => {
  assert.equal(compareSemver("2.0.82", "2.0.84"), -1);
  assert.equal(compareSemver("v2.0.82", "v2.0.82"), 0);
  assert.equal(compareSemver("2.1.0", "2.0.99"), 1);
  assert.equal(compareSemver("invalid", "2.0.84"), null);
});

test("isCriticalRelease detects [CRITICAL] marker case-insensitively", () => {
  assert.equal(isCriticalRelease("Mizan v2.0.90", "Regular improvements"), false);
  assert.equal(isCriticalRelease("Mizan v2.0.90 [CRITICAL]", "Security update"), true);
  assert.equal(isCriticalRelease("Mizan v2.0.90", "Important [critical] patch for sync"), true);
});

test("extractCleanReleaseNotes strips boilerplate metadata lines", () => {
  const raw = [
    "Android Release APK for Mizan Finance Multi-Tenant Platform.",
    "- Direct Download: `mizan-finance-release.apk`",
    "- Commit: `af09a5eaf1b0752d4bf9e7a8a7efef0b73d484bc`",
    "- SHA-256: `3412e98c6`",
    "- Signing: CI Certificate",
    "إصلاح إقلاع التطبيق وتحسين سرعة المزامنة [CRITICAL]",
  ].join("\n");
  assert.equal(extractCleanReleaseNotes(raw), "إصلاح إقلاع التطبيق وتحسين سرعة المزامنة");
});

test("evaluateGithubRelease returns soft update and respects dismissed version", () => {
  const payload = {
    tag_name: "v2.0.85",
    name: "Mizan Finance v2.0.85",
    body: "تحسين سرعة المزامنة وإضافة فاحص التحديثات",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "mizan-finance-release.apk",
        browser_download_url:
          "https://github.com/zyadgfh/mizan-finance-original/releases/download/v2.0.85/mizan-finance-release.apk",
      },
    ],
  };

  const available = evaluateGithubRelease(payload, "2.0.82", null);
  assert.ok(available);
  assert.equal(available.critical, false);
  assert.equal(available.latestVersion, "2.0.85");
  assert.equal(
    available.downloadUrl,
    "https://github.com/zyadgfh/mizan-finance-original/releases/download/v2.0.85/mizan-finance-release.apk",
  );

  // Dismissing 2.0.85 suppresses the soft banner
  assert.equal(evaluateGithubRelease(payload, "2.0.82", "2.0.85"), null);
  // Same or newer installed version returns null
  assert.equal(evaluateGithubRelease(payload, "2.0.85", null), null);
  assert.equal(evaluateGithubRelease(payload, "2.0.90", null), null);
});

test("evaluateGithubRelease forces [CRITICAL] updates even if previously dismissed", () => {
  const criticalPayload = {
    tag_name: "v2.0.86",
    name: "Mizan Finance v2.0.86 [CRITICAL]",
    body: "تحديث أمني إلزامي لحماية الحسابات",
    draft: false,
    prerelease: false,
    assets: [],
  };

  const forced = evaluateGithubRelease(criticalPayload, "2.0.82", "2.0.86");
  assert.ok(forced);
  assert.equal(forced.critical, true);
  assert.equal(forced.downloadUrl, FALLBACK_APK_DOWNLOAD_URL);
});
