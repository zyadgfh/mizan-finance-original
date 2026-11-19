import assert from "node:assert/strict";
import test from "node:test";
import { validateFile, formatBytes, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./files.ts";

test("validateFile blocks dangerous extensions regardless of declared MIME", () => {
  const r = validateFile("payload.svg", "image/png", 1000);
  assert.equal(r.ok, false);
});

test("validateFile rejects MIME types outside the allowlist", () => {
  const r = validateFile("app.bin", "application/x-msdownload", 1000);
  assert.equal(r.ok, false);
});

test("validateFile enforces the general and image-specific size limits", () => {
  assert.equal(validateFile("doc.pdf", "application/pdf", MAX_FILE_BYTES + 1).ok, false);
  assert.equal(validateFile("photo.png", "image/png", MAX_IMAGE_BYTES + 1).ok, false);
  assert.equal(validateFile("photo.png", "image/png", 1024).ok, true);
});

test("validateFile accepts an allowlisted document under the size limit", () => {
  const r = validateFile("report.pdf", "application/pdf", 2048);
  assert.equal(r.ok, true);
});

test("formatBytes renders human-readable sizes", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
