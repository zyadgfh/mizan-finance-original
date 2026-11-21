import { getNativeAppVersion, isNativeMobileApp } from "../mobile-safe.ts";

export const MANUAL_APK_UPDATE_EVENT = "mizan:check-apk-update";

export function triggerManualApkUpdateCheck(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MANUAL_APK_UPDATE_EVENT));
}

export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/zyadgfh/mizan-finance-original/releases/latest";

export const FALLBACK_APK_DOWNLOAD_URL =
  "https://github.com/zyadgfh/mizan-finance-original/releases/latest/download/mizan-finance-release.apk";

const DISMISSED_VERSION_STORAGE_KEY = "mizan.apk.dismissedVersion.v1";
const CACHED_RELEASE_SESSION_KEY = "mizan.apk.latestCheckCache.v1";
const CACHE_TTL_MS = 30 * 60 * 1000;

export type ApkUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  title: string;
  notes: string;
  downloadUrl: string;
  publishedAt: string | null;
  critical: boolean;
};

export function normalizeVersionParts(raw: string): number[] | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[+-]/)[0]
    ?.trim();
  if (!cleaned || !/^\d+(?:\.\d+){0,3}$/.test(cleaned)) {
    return null;
  }
  const parts = cleaned.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts;
}

/**
 * Returns -1 if `current < latest`, 0 if equal, 1 if `current > latest`,
 * or null when either version string is invalid.
 */
export function compareSemver(current: string, latest: string): -1 | 0 | 1 | null {
  const cur = normalizeVersionParts(current);
  const lat = normalizeVersionParts(latest);
  if (!cur || !lat) return null;
  const len = Math.max(cur.length, lat.length);
  for (let i = 0; i < len; i += 1) {
    const a = cur[i] ?? 0;
    const b = lat[i] ?? 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

export function isCriticalRelease(title: string, body: string): boolean {
  const combined = `${title ?? ""}\n${body ?? ""}`;
  return /\[critical\]/i.test(combined);
}

export function extractCleanReleaseNotes(body: string): string {
  if (!body) return "";
  const lines = body
    .replace(/\[critical\]/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^-\s*(?:Direct Download|Commit|SHA-256|Signing):/i.test(line)) return false;
      if (/^Android Release APK for Mizan Finance/i.test(line)) return false;
      return true;
    });
  return lines.slice(0, 4).join(" • ").slice(0, 280);
}

function resolveTrustedDownloadUrl(rawRelease: Record<string, unknown>): string {
  const assets = Array.isArray(rawRelease.assets) ? rawRelease.assets : [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const rec = asset as Record<string, unknown>;
    const name = String(rec.name ?? "");
    const url = String(rec.browser_download_url ?? "").trim();
    if (
      name.endsWith(".apk") &&
      url.startsWith("https://github.com/zyadgfh/mizan-finance-original/")
    ) {
      return url;
    }
  }
  return FALLBACK_APK_DOWNLOAD_URL;
}

export function evaluateGithubRelease(
  rawRelease: unknown,
  currentVersion: string,
  dismissedVersion?: string | null,
): ApkUpdateInfo | null {
  if (!rawRelease || typeof rawRelease !== "object") return null;
  const rel = rawRelease as Record<string, unknown>;
  if (rel.draft === true || rel.prerelease === true) return null;

  const tagName = String(rel.tag_name ?? "").trim();
  if (!tagName) return null;

  const latestVersion = tagName.replace(/^v/i, "");
  const cmp = compareSemver(currentVersion, latestVersion);
  if (cmp !== -1) return null;

  const title = String(rel.name ?? tagName).trim();
  const body = String(rel.body ?? "");
  const critical = isCriticalRelease(title, body);

  const normalizedDismissed = String(dismissedVersion ?? "")
    .trim()
    .replace(/^v/i, "");
  if (!critical && normalizedDismissed && normalizedDismissed === latestVersion) {
    return null;
  }

  return {
    currentVersion: currentVersion.trim().replace(/^v/i, ""),
    latestVersion,
    tagName: tagName.startsWith("v") ? tagName : `v${latestVersion}`,
    title: title.replace(/\[critical\]/gi, "").trim() || `Mizan Finance v${latestVersion}`,
    notes: extractCleanReleaseNotes(body),
    downloadUrl: resolveTrustedDownloadUrl(rel),
    publishedAt: typeof rel.published_at === "string" ? rel.published_at : null,
    critical,
  };
}

export function readDismissedApkVersion(storage?: Storage): string | null {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    return store?.getItem(DISMISSED_VERSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function dismissApkUpdate(version: string, storage?: Storage): void {
  try {
    const clean = String(version ?? "").trim().replace(/^v/i, "");
    if (!clean) return;
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    store?.setItem(DISMISSED_VERSION_STORAGE_KEY, clean);
  } catch {
    /* ignore */
  }
}

export async function checkLatestApkUpdate(options?: {
  force?: boolean;
  currentVersionOverride?: string;
  fetchImpl?: typeof fetch;
}): Promise<ApkUpdateInfo | null> {
  const currentVersion = options?.currentVersionOverride ?? getNativeAppVersion();
  if (!currentVersion) {
    return null;
  }
  if (!options?.currentVersionOverride && !isNativeMobileApp()) {
    return null;
  }

  const dismissed = readDismissedApkVersion();

  if (!options?.force && typeof sessionStorage !== "undefined") {
    try {
      const cachedRaw = sessionStorage.getItem(CACHED_RELEASE_SESSION_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { at?: number; payload?: unknown };
        if (cached && typeof cached.at === "number" && Date.now() - cached.at < CACHE_TTL_MS) {
          return evaluateGithubRelease(cached.payload, currentVersion, dismissed);
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  const fetcher = options?.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!fetcher) return null;

  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const res = await fetcher(GITHUB_LATEST_RELEASE_API, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
        signal: controller?.signal,
      });
      if (!res.ok) return null;
      const payload: unknown = await res.json();
      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem(
            CACHED_RELEASE_SESSION_KEY,
            JSON.stringify({ at: Date.now(), payload }),
          );
        } catch {
          /* ignore */
        }
      }
      return evaluateGithubRelease(payload, currentVersion, dismissed);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
