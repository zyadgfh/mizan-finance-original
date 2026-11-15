import { isCurrency } from "../finance/logic.ts";
import type { Data } from "../finance/types.ts";

export type EncryptedBackupEnvelope = {
  encrypted: true;
  version: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

const KDF_ITERATIONS = 120_000;

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]) {
  if (!passphrase) throw new Error("كلمة مرور التشفير مطلوبة");
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export function isEncryptedBackupEnvelope(value: unknown): value is EncryptedBackupEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<EncryptedBackupEnvelope>;
  return (
    v.encrypted === true &&
    v.version === 1 &&
    v.alg === "AES-GCM" &&
    v.kdf === "PBKDF2-SHA256" &&
    typeof v.iterations === "number" &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.ciphertext === "string"
  );
}

export async function encryptBackupPayload(plainJson: string, passphrase: string): Promise<EncryptedBackupEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, KDF_ITERATIONS, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    new TextEncoder().encode(plainJson),
  );
  return {
    encrypted: true,
    version: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(cipher)),
  };
}

export async function decryptBackupPayload(
  envelope: EncryptedBackupEnvelope,
  passphrase: string,
): Promise<string> {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error("صيغة النسخة المشفّرة غير صالحة");
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations || KDF_ITERATIONS, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("كلمة مرور فك التشفير غير صحيحة أو البيانات تالفة");
  }
}

export type BackupValidationResult =
  | { ok: true; summary: { txCount: number; debtCount: number; personCount: number; goalCount: number } }
  | { ok: false; error: string };

function isIsoLike(s: unknown): boolean {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function validateBackupJsonObject(raw: unknown): BackupValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "الملف ليس كائن JSON صالحاً" };
  }
  const d = raw as Partial<Data>;
  if (
    !Array.isArray(d.txns) ||
    !Array.isArray(d.people) ||
    !Array.isArray(d.debts) ||
    !Array.isArray(d.payments) ||
    !Array.isArray(d.categories)
  ) {
    return { ok: false, error: "ينقص الملف جداول أساسية (الحركات/الأشخاص/الديون/الفئات)" };
  }
  if (d.currency !== undefined && !isCurrency(d.currency)) {
    return { ok: false, error: "العملة داخل النسخة الاحتياطية غير مدعومة" };
  }
  if (d.openingBalance !== undefined && (typeof d.openingBalance !== "number" || !Number.isFinite(d.openingBalance) || d.openingBalance < 0)) {
    return { ok: false, error: "الرصيد الافتتاحي غير صالح" };
  }
  for (const t of d.txns) {
    if (
      !t ||
      typeof t !== "object" ||
      typeof t.id !== "string" ||
      (t.kind !== "income" && t.kind !== "expense") ||
      typeof t.amount !== "number" ||
      !Number.isFinite(t.amount) ||
      t.amount <= 0 ||
      typeof t.categoryId !== "string" ||
      !isIsoLike(t.date)
    ) {
      return { ok: false, error: "توجد حركة مالية غير مكتملة أو بمبلغ/تاريخ غير صالح" };
    }
  }
  for (const p of d.people) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.name !== "string" || !p.name.trim()) {
      return { ok: false, error: "يوجد سجل شخص بدون معرّف أو اسم صالح" };
    }
  }
  for (const debt of d.debts) {
    if (
      !debt ||
      typeof debt !== "object" ||
      typeof debt.id !== "string" ||
      typeof debt.personId !== "string" ||
      (debt.direction !== "receivable" && debt.direction !== "payable") ||
      typeof debt.principal !== "number" ||
      !Number.isFinite(debt.principal) ||
      debt.principal <= 0
    ) {
      return { ok: false, error: "يوجد سجل دين غير صالح أو بمبلغ غير صحيح" };
    }
  }
  for (const pay of d.payments) {
    if (
      !pay ||
      typeof pay !== "object" ||
      typeof pay.id !== "string" ||
      typeof pay.debtId !== "string" ||
      typeof pay.amount !== "number" ||
      !Number.isFinite(pay.amount) ||
      pay.amount <= 0
    ) {
      return { ok: false, error: "يوجد سجل دفعة دين بمبلغ أو مرجع غير صالح" };
    }
  }

  return {
    ok: true,
    summary: {
      txCount: d.txns.length,
      debtCount: d.debts.length,
      personCount: d.people.length,
      goalCount: Array.isArray(d.goals) ? d.goals.length : 0,
    },
  };
}
