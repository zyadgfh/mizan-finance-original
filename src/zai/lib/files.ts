// File: src/zai/lib/files.ts — attachment validation (frontend + mirrored backend)
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "image/png","image/jpeg","image/webp","image/gif",
  "application/pdf","text/plain","text/markdown","text/csv",
  "application/json","application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const BLOCKED_EXT = new Set(["svg","exe","dll","sh","bat","js","html","php","py","jar","apk","msi"]);
export function validateFile(name: string, mime: string, size: number): { ok: boolean; reason?: string } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (BLOCKED_EXT.has(ext)) return { ok: false, reason: "نوع ملف غير مسموح" };
  if (mime && !ALLOWED_MIME.has(mime)) return { ok: false, reason: "نوع MIME غير مدعوم" };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: "الملف أكبر من 10MB" };
  if (mime.startsWith("image/") && size > MAX_IMAGE_BYTES) return { ok: false, reason: "الصورة أكبر من 8MB" };
  if (!name || name.length > 255) return { ok: false, reason: "اسم ملف غير صالح" };
  return { ok: true };
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
