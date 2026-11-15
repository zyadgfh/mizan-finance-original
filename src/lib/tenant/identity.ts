export const PHONE_SYNTHETIC_DOMAIN = "@phone.mizan-app.local";

export function toAsciiDigits(input: string): string {
  return String(input ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export type NormalizedSubscriberIdentity = {
  kind: "email" | "phone";
  authEmail: string;
  contactDisplay: string;
  phone: string | null;
};

export function normalizeSubscriberIdentity(rawInput: string): NormalizedSubscriberIdentity | null {
  const ascii = toAsciiDigits(rawInput).trim();
  if (!ascii) return null;

  if (ascii.includes("@")) {
    const lower = ascii.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lower)) {
      return null;
    }
    return {
      kind: "email",
      authEmail: lower,
      contactDisplay: lower,
      phone: null,
    };
  }

  let cleaned = ascii.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("00")) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  // Egyptian mobile numbers in any format: 010..., +2010..., 2010..., 10...
  const egMatch = cleaned.match(/^(?:\+?20|0)?(1[0125]\d{8})$/);
  if (egMatch) {
    const core10 = egMatch[1];
    const canonicalDigits = `20${core10}`;
    return {
      kind: "phone",
      authEmail: `p.${canonicalDigits}${PHONE_SYNTHETIC_DOMAIN}`,
      contactDisplay: `0${core10}`,
      phone: `+${canonicalDigits}`,
    };
  }

  const digitsOnly = cleaned.replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(digitsOnly)) {
    return null;
  }

  const displayPhone = cleaned.startsWith("+") ? cleaned : digitsOnly;
  return {
    kind: "phone",
    authEmail: `p.${digitsOnly}${PHONE_SYNTHETIC_DOMAIN}`,
    contactDisplay: displayPhone,
    phone: cleaned.startsWith("+") ? cleaned : `+${digitsOnly}`,
  };
}

export function cleanDisplayContact(
  email: string | null | undefined,
  phone?: string | null,
  contactDisplay?: string | null,
): string {
  const rawEmail = String(email ?? "").trim();
  if (contactDisplay && !contactDisplay.endsWith(PHONE_SYNTHETIC_DOMAIN)) {
    return contactDisplay;
  }
  if (phone) {
    const egMatch = phone.match(/^\+?20(1[0125]\d{8})$/);
    return egMatch ? `0${egMatch[1]}` : phone;
  }
  if (rawEmail.endsWith(PHONE_SYNTHETIC_DOMAIN)) {
    const digits = rawEmail.slice(2, -PHONE_SYNTHETIC_DOMAIN.length);
    if (/^201[0125]\d{8}$/.test(digits)) {
      return `0${digits.slice(2)}`;
    }
    return `+${digits}`;
  }
  return rawEmail;
}

/**
 * Compresses and resizes a transfer screenshot / receipt image on the client
 * so large mobile screenshots upload reliably and fast with zero size errors.
 */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;

function inferImageMime(file: File, bytes?: Uint8Array): string {
  if (file.type && file.type.startsWith("image/")) return file.type;
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }
  }
  const lower = (file.name || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function compressTransferProofImage(file: File): Promise<string> {
  if (!file) {
    throw new Error("يرجى اختيار ملف صورة صالح (JPG أو PNG أو WEBP)");
  }
  const hasExplicitNonImageMime =
    Boolean(file.type) &&
    !file.type.startsWith("image/") &&
    file.type !== "application/octet-stream" &&
    !IMAGE_EXT_RE.test(file.name || "");
  if (hasExplicitNonImageMime) {
    throw new Error("يرجى اختيار ملف صورة صالح (JPG أو PNG أو WEBP)");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("حجم الصورة كبير جداً (الحد الأقصى 20 ميجابايت)");
  }

  let normalizedBlob: Blob = file;
  if (!file.type || !file.type.startsWith("image/")) {
    try {
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const mime = inferImageMime(file, header);
      normalizedBlob = new Blob([file], { type: mime });
    } catch {
      normalizedBlob = new Blob([file], { type: inferImageMime(file) });
    }
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("تعذّر قراءة ملف الصورة"));
    };
    reader.onerror = () => reject(new Error("تعذّر قراءة ملف الصورة"));
    reader.readAsDataURL(normalizedBlob);
  });

  if (typeof document === "undefined" || typeof Image === "undefined") {
    return rawDataUrl;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("صيغة الصورة غير مدعومة"));
      el.src = rawDataUrl;
    });

    const maxDim = 1280;
    const origW = img.naturalWidth || img.width || 800;
    const origH = img.naturalHeight || img.height || 800;
    const scale = Math.min(1, maxDim / Math.max(origW, origH));
    const targetW = Math.max(1, Math.round(origW * scale));
    const targetH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return rawDataUrl;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let out = canvas.toDataURL("image/jpeg", 0.8);
    if (out.length > 2_600_000) {
      out = canvas.toDataURL("image/jpeg", 0.62);
    }
    if (out.length > 2_600_000) {
      out = canvas.toDataURL("image/jpeg", 0.45);
    }
    return out;
  } catch {
    if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(rawDataUrl)) {
      return rawDataUrl;
    }
    throw new Error("يرجى اختيار صورة بصيغة JPG أو PNG");
  }
}
