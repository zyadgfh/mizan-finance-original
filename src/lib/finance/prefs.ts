import { useEffect, useSyncExternalStore } from "react";

export const UI_PREFS_STORAGE_KEY = "mizan.ui-prefs.v1";

export type AppLanguage = "ar" | "en";
export type NumeralStyle = "latn" | "arab";

export type AppleThemeId =
  | "liquid-glass"
  | "cupertino-classic"
  | "titanium-pro"
  | "emerald-vault"
  | "midnight-indigo"
  | "desert-sand";

export type AppearanceMode = "system" | "light" | "dark";

export type AppleThemeDefinition = {
  id: AppleThemeId;
  nameAr: string;
  nameEn: string;
  subAr: string;
  subEn: string;
  swatch: string;
  accent: string;
};

export const APPLE_THEMES: readonly AppleThemeDefinition[] = [
  {
    id: "liquid-glass",
    nameAr: "زجاج Apple السائل",
    nameEn: "Apple Liquid Glass",
    subAr: "زجاج بلوري شفّاف ولمعان iOS 26",
    subEn: "Frosted translucent crystal & iOS 26 specular glow",
    swatch: "linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)",
    accent: "#007AFF",
  },
  {
    id: "cupertino-classic",
    nameAr: "كوبرتينو النقي",
    nameEn: "Classic Cupertino",
    subAr: "أبيض ناصع وخطوط Apple Wallet الدقيقة",
    subEn: "Pure alabaster surfaces & crisp Apple Wallet hairlines",
    swatch: "linear-gradient(135deg, #0066CC 0%, #3395FF 100%)",
    accent: "#0066CC",
  },
  {
    id: "titanium-pro",
    nameAr: "تيتانيوم برو الفاخر",
    nameEn: "Titanium Pro",
    subAr: "معدن تيتانيوم دافئ ولمسات ذهبية فاخرة",
    subEn: "Brushed natural titanium & warm champagne gold",
    swatch: "linear-gradient(135deg, #3A3835 0%, #C59B43 100%)",
    accent: "#B8860B",
  },
  {
    id: "emerald-vault",
    nameAr: "الخزنة الزمردية",
    nameEn: "Emerald Private Bank",
    subAr: "أناقة البنوك الخاصة بلمسة Apple Cash الخضراء",
    subEn: "Private wealth emerald & crisp mint glass",
    swatch: "linear-gradient(135deg, #047857 0%, #10B981 100%)",
    accent: "#059669",
  },
  {
    id: "midnight-indigo",
    nameAr: "نيلي أبل الليلي",
    nameEn: "Midnight Indigo",
    subAr: "عمق كوني نيلي مريح للعين بأسلوب Apple Card",
    subEn: "Deep cosmic indigo & violet Apple Card aura",
    swatch: "linear-gradient(135deg, #4338CA 0%, #7C3AED 100%)",
    accent: "#5856D6",
  },
  {
    id: "desert-sand",
    nameAr: "تيتانيوم الصحراء",
    nameEn: "Desert Titanium",
    subAr: "درجات رملية دافئة ناعمة على العين",
    subEn: "Warm desert sandstone & soft amber highlights",
    swatch: "linear-gradient(135deg, #9A5822 0%, #E08E45 100%)",
    accent: "#C26D27",
  },
] as const;

const VALID_THEMES = new Set<string>(APPLE_THEMES.map((t) => t.id));

export type UiPrefs = {
  language: AppLanguage;
  numeralStyle: NumeralStyle;
  analyticsEnabled: boolean;
  appleTheme: AppleThemeId;
  colorMode: AppearanceMode;
  cardsSectionTitle: string;
};

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: "ar",
  numeralStyle: "latn",
  analyticsEnabled: true,
  appleTheme: "liquid-glass",
  colorMode: "system",
  cardsSectionTitle: "",
};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSnapshot: UiPrefs = DEFAULT_UI_PREFS;

function normalizeUiPrefs(raw: Partial<UiPrefs> | null | undefined): UiPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_UI_PREFS;
  const appleTheme: AppleThemeId =
    typeof raw.appleTheme === "string" && VALID_THEMES.has(raw.appleTheme)
      ? (raw.appleTheme as AppleThemeId)
      : "liquid-glass";
  const colorMode: AppearanceMode =
    raw.colorMode === "light" || raw.colorMode === "dark" || raw.colorMode === "system"
      ? raw.colorMode
      : "system";
  return {
    language: raw.language === "en" ? "en" : "ar",
    numeralStyle: raw.numeralStyle === "arab" ? "arab" : "latn",
    analyticsEnabled: raw.analyticsEnabled !== false,
    appleTheme,
    colorMode,
    cardsSectionTitle: typeof raw.cardsSectionTitle === "string" ? raw.cardsSectionTitle.slice(0, 48) : "",
  };
}

export function applyDocumentLanguageAndDir(language: AppLanguage): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  root.lang = language;
  root.dir = language === "en" ? "ltr" : "rtl";
}

export function applyAppearanceToDocument(
  prefs: Pick<UiPrefs, "appleTheme" | "colorMode">,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  const theme = prefs.appleTheme || "liquid-glass";
  const mode = prefs.colorMode || "system";
  root.dataset.appleTheme = theme;
  root.dataset.colorMode = mode;

  const prefersDark =
    mode === "dark" ||
    (mode === "system" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lightBg: Record<AppleThemeId, string> = {
    "liquid-glass": "#eef3fa",
    "cupertino-classic": "#f5f5f7",
    "titanium-pro": "#f1efe9",
    "emerald-vault": "#edf5f1",
    "midnight-indigo": "#eff0fa",
    "desert-sand": "#f6f1eb",
  };
  const darkBg: Record<AppleThemeId, string> = {
    "liquid-glass": "#05070c",
    "cupertino-classic": "#000000",
    "titanium-pro": "#0c0b0a",
    "emerald-vault": "#040d0a",
    "midnight-indigo": "#070816",
    "desert-sand": "#100c09",
  };
  const bgHex = prefersDark ? darkBg[theme] : lightBg[theme];
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", bgHex);
  }
  if (typeof window !== "undefined") {
    const nativeBridge = (
      window as Window & {
        MizanNative?: { setSystemBarStyle?: (hexColor: string, darkIcons: boolean) => boolean };
      }
    ).MizanNative;
    try {
      nativeBridge?.setSystemBarStyle?.(bgHex, !prefersDark);
    } catch {
      // Ignore bridge errors outside Android WebView
    }
  }
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
    applyAppearanceToDocument(cachedSnapshot);
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
    applyAppearanceToDocument(normalized);
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
  const { language, appleTheme, colorMode } = prefs;
  useEffect(() => {
    applyDocumentLanguageAndDir(language);
    applyAppearanceToDocument({ appleTheme, colorMode });
  }, [language, appleTheme, colorMode]);
  return prefs;
}

export function getUiPrefs(): UiPrefs {
  return typeof localStorage !== "undefined" ? getClientSnapshot() : DEFAULT_UI_PREFS;
}

if (typeof window !== "undefined") {
  applyAppearanceToDocument(getUiPrefs());
}
