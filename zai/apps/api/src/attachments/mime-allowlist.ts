// File: zai/apps/api/src/attachments/mime-allowlist.ts
// Server-side mirror of src/zai/lib/files.ts — the authoritative check, since
// the frontend check can be bypassed. Real deployments should additionally
// run a magic-byte sniff (e.g. `file-type` package) on the uploaded object
// inside the S3 "complete" webhook rather than trusting the client MIME.
export const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json",
]);
export const BLOCKED_EXT = new Set(["svg", "exe", "dll", "sh", "bat", "js", "html", "php", "py", "jar", "apk", "msi"]);

export function validateUpload(fileName: string, mimeType: string, sizeBytes: number): { ok: boolean; reason?: string } {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (BLOCKED_EXT.has(ext)) return { ok: false, reason: "extension_blocked" };
  if (!ALLOWED_MIME.has(mimeType)) return { ok: false, reason: "mime_not_allowed" };
  if (sizeBytes > 10 * 1024 * 1024) return { ok: false, reason: "too_large" };
  return { ok: true };
}
