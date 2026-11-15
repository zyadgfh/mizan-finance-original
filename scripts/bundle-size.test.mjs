import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { measureAssetDir } from "./check-bundle-size.mjs";

test("measureAssetDir computes raw and gzipped sizes for JS and CSS assets", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mizan-bundle-test-"));
  try {
    writeFileSync(path.join(dir, "index-abc.js"), "console.log('mizan');".repeat(20));
    writeFileSync(path.join(dir, "lazy-xyz.js"), "export const x = 42;");
    writeFileSync(path.join(dir, "styles-123.css"), "body { color: #000; }");

    const report = measureAssetDir(dir);
    assert.ok(report);
    assert.equal(report.jsCount, 2);
    assert.equal(report.cssCount, 1);
    assert.ok(report.totalJsRaw > 0);
    assert.ok(report.totalJsGzip > 0);
    assert.ok(report.totalCssGzip > 0);
    assert.equal(report.largestJs?.file, "index-abc.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
