import { useEffect, useSyncExternalStore } from "react";

export const UI_PREFS_STORAGE_KEY = "mizan.ui-prefs.v1";

export type AppLanguage = "ar" | "en";
export type NumeralStyle = "latn" | "arab";

export type UiPrefs = {
  language: AppLanguage;
  numeralStyle: NumeralStyle;
  analyticsEnabled: boolean;
};

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: "ar",
  numeralStyle: "latn",
  analyticsEnabled: true,
};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSnapshot: UiPrefs = DEFAULT_UI_PREFS;

function normalizeUiPrefs(raw: Partial<UiPrefs> | null | undefined): UiPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_UI_PREFS;
  return {
    language: raw.language === "en" ? "en" : "ar",
    numeralStyle: raw.numeralStyle === "arab" ? "arab" : "latn",
    analyticsEnabled: raw.analyticsEnabled !== false,
  };
}

export function applyDocumentLanguageAndDir(language: AppLanguage): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  root.lang = language;
  root.dir = language === "en" ? "ltr" : "rtl";
}

export function loadUiPrefs(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): UiPrefs {
  try {
    const raw = storage?.getItem(UI_PREFS_STORAGE_KEY) ?? null;
    if (!raw) return DEFAULT_UI_PREFS;
    return normalizeUiPrefs(JSON.parse(raw) as Partial<UiPrefs>);
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

function getClientSnapshot(): UiPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_UI_PREFS;
  const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = loadUiPrefs(localStorage);
  }
  return cachedSnapshot;
}

const getServerSnapshot = () => DEFAULT_UI_PREFS;

export function saveUiPrefs(
  next: UiPrefs,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): UiPrefs {
  const normalized = normalizeUiPrefs(next);
  const serialized = JSON.stringify(normalized);
  try {
    storage?.setItem(UI_PREFS_STORAGE_KEY, serialized);
  } catch {
    /* ignore storage unavailable */
  }
  if (storage === undefined || (typeof localStorage !== "undefined" && storage === localStorage)) {
    cachedRaw = serialized;
    cachedSnapshot = normalized;
    applyDocumentLanguageAndDir(normalized.language);
    for (const listener of listeners) listener();
  }
  return normalized;
}

export function updateUiPrefs(
  patch: Partial<UiPrefs>,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): UiPrefs {
  return saveUiPrefs({ ...loadUiPrefs(storage), ...patch }, storage);
}

export function subscribeUiPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiPrefs(): UiPrefs {
  const prefs = useSyncExternalStore(subscribeUiPrefs, getClientSnapshot, getServerSnapshot);
  useEffect(() => {
    applyDocumentLanguageAndDir(prefs.language);
  }, [prefs.language]);
  return prefs;
}

export function getUiPrefs(): UiPrefs {
  return typeof localStorage !== "undefined" ? getClientSnapshot() : DEFAULT_UI_PREFS;
}
