/**
 * Mobile-safe browser & Android WebView utilities.
 * Prevents crashes on mobile LAN HTTP testing, older WebViews, iOS Safari,
 * and Capacitor Android APKs where crypto.randomUUID or navigator.clipboard
 * can throw or be unavailable.
 */

type MizanNativeWindow = Window & {
  MizanNative?: {
    copyToClipboard?: (text: string) => boolean;
    consumeLaunchUrl?: () => string;
    getAppVersion?: () => string;
    openExternalUrl?: (url: string) => boolean;
    shareFile?: (filename: string, mimeType: string, content: string) => boolean;
    shareBinaryFile?: (filename: string, mimeType: string, base64Content: string) => boolean;
    setScreenSecure?: (secure: boolean) => boolean;
  };
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

export function getNativeAppVersion(): string {
  if (typeof window === "undefined") return "";
  try {
    const fn = (window as MizanNativeWindow).MizanNative?.getAppVersion;
    if (typeof fn === "function") {
      return String(fn() ?? "").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function openExternalUrlSafe(url: string): boolean {
  if (!url || typeof window === "undefined") return false;
  try {
    const fn = (window as MizanNativeWindow).MizanNative?.openExternalUrl;
    if (typeof fn === "function" && fn(url)) {
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return true;
    window.location.assign(url);
    return true;
  } catch {
    return false;
  }
}

export function isNativeMobileApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as MizanNativeWindow;
  if (w.MizanNative) return true;
  if (typeof w.Capacitor?.isNativePlatform === "function" && w.Capacitor.isNativePlatform()) {
    return true;
  }
  return window.location.protocol.startsWith("capacitor");
}

export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fallback below */
    }
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof window !== "undefined") {
    const native = (window as MizanNativeWindow).MizanNative;
    if (native && typeof native.copyToClipboard === "function") {
      try {
        if (native.copyToClipboard(text)) return true;
      } catch {
        /* fallback */
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback to execCommand on mobile WebView / iOS */
    }
  }

  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(ta);
      if (copied) return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}

let keyboardAssistInstalled = false;

/**
 * Ensures focused inputs inside sheets and standalone forms remain visible
 * above the mobile virtual keyboard on iOS Safari & Android WebView.
 */
export function installMobileKeyboardScrollAssist(): void {
  if (keyboardAssistInstalled || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  keyboardAssistInstalled = true;

  document.addEventListener(
    "focusin",
    (e) => {
      if (window.innerWidth > 768) return;
      const target = e.target;
      if (
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        return;
      }
      if (target.type === "file" || target.type === "checkbox" || target.type === "radio") {
        return;
      }
      window.setTimeout(() => {
        try {
          if (document.activeElement === target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        } catch {
          /* ignore */
        }
      }, 280);
    },
    { passive: true },
  );
}
