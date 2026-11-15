import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = process.cwd();

const TARGETS = [
  {
    name: "web",
    dirs: [
      path.join(ROOT, ".vercel", "output", "static", "assets"),
      path.join(ROOT, ".output", "public", "assets"),
      path.join(ROOT, "dist", "assets"),
    ],
    // Budget in bytes (gzip): keeps initial route & index tight while accounting for React/TanStack/GSAP/crypto
    maxLargestChunkGzipBytes: 185 * 1024,
    maxTotalJsGzipBytes: 520 * 1024,
    minTotalCssRawBytes: 55 * 1024,
  },
  {
    name: "native",
    dirs: [path.join(ROOT, "native-dist", "assets")],
    maxLargestChunkGzipBytes: 210 * 1024,
    maxTotalJsGzipBytes: 460 * 1024,
    minTotalCssRawBytes: 55 * 1024,
  },
];

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

export function measureAssetDir(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".css"))
    .sort();
  const entries = files.map((file) => {
    const full = path.join(dir, file);
    const buf = readFileSync(full);
    const gzipBytes = gzipSync(buf, { level: 9 }).length;
    return {
      file,
      type: file.endsWith(".css") ? "css" : "js",
      rawBytes: buf.length,
      gzipBytes,
    };
  });
  const js = entries.filter((e) => e.type === "js");
  const css = entries.filter((e) => e.type === "css");
  const totalJsRaw = js.reduce((s, e) => s + e.rawBytes, 0);
  const totalJsGzip = js.reduce((s, e) => s + e.gzipBytes, 0);
  const totalCssRaw = css.reduce((s, e) => s + e.rawBytes, 0);
  const totalCssGzip = css.reduce((s, e) => s + e.gzipBytes, 0);
  const largestJs = [...js].sort((a, b) => b.gzipBytes - a.gzipBytes)[0] ?? null;

  return {
    dir,
    entries,
    jsCount: js.length,
    cssCount: css.length,
    totalJsRaw,
    totalJsGzip,
    totalCssRaw,
    totalCssGzip,
    largestJs,
  };
}

export function runBundleCheck(onlyTarget) {
  const results = [];
  let failures = 0;

  for (const target of TARGETS) {
    if (onlyTarget && target.name !== onlyTarget) continue;
    const foundDir = target.dirs.find((d) => existsSync(d));
    if (!foundDir) continue;
    const report = measureAssetDir(foundDir);
    if (!report) continue;

    console.log(`\n[bundle-size] ${target.name} (${path.relative(ROOT, foundDir)})`);
    console.log(
      `  JS: ${report.jsCount} chunks | raw ${formatKb(report.totalJsRaw)} | gzip ${formatKb(report.totalJsGzip)}`,
    );
    console.log(
      `  CSS: ${report.cssCount} files | raw ${formatKb(report.totalCssRaw)} | gzip ${formatKb(report.totalCssGzip)}`,
    );
    if (report.largestJs) {
      console.log(
        `  Largest JS chunk: ${report.largestJs.file} (raw ${formatKb(report.largestJs.rawBytes)}, gzip ${formatKb(report.largestJs.gzipBytes)})`,
      );
    }

    const topChunks = [...report.entries]
      .filter((e) => e.type === "js")
      .sort((a, b) => b.gzipBytes - a.gzipBytes)
      .slice(0, 5);
    for (const c of topChunks) {
      console.log(`    - ${c.file}: raw ${formatKb(c.rawBytes)} | gzip ${formatKb(c.gzipBytes)}`);
    }

    if (report.largestJs && report.largestJs.gzipBytes > target.maxLargestChunkGzipBytes) {
      console.error(
        `[bundle-size] FAIL: ${target.name} largest chunk ${report.largestJs.file} (${formatKb(report.largestJs.gzipBytes)}) exceeds limit ${formatKb(target.maxLargestChunkGzipBytes)}`,
      );
      failures++;
    }
    if (report.totalJsGzip > target.maxTotalJsGzipBytes) {
      console.error(
        `[bundle-size] FAIL: ${target.name} total JS gzip (${formatKb(report.totalJsGzip)}) exceeds limit ${formatKb(target.maxTotalJsGzipBytes)}`,
      );
      failures++;
    }
    if (target.minTotalCssRawBytes && report.totalCssRaw < target.minTotalCssRawBytes) {
      console.error(
        `[bundle-size] FAIL: ${target.name} total CSS raw (${formatKb(report.totalCssRaw)}) is below minimum ${formatKb(target.minTotalCssRawBytes)} — Tailwind utility classes may be missing!`,
      );
      failures++;
    }
    const combinedCss = report.entries
      .filter((e) => e.type === "css")
      .map((e) => readFileSync(path.join(foundDir, e.file), "utf8"))
      .join("\n");
    if (!combinedCss.includes("@layer utilities") || !combinedCss.includes(".flex")) {
      console.error(
        `[bundle-size] FAIL: ${target.name} CSS bundle is missing Tailwind @layer utilities (.flex)!`,
      );
      failures++;
    }

    results.push({ target: target.name, ...report });
  }

  if (results.length === 0) {
    console.error("[bundle-size] No build asset directories found. Run build first.");
    return { ok: false, results };
  }

  return { ok: failures === 0, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const onlyTarget = process.argv[2];
  const { ok } = runBundleCheck(onlyTarget);
  if (!ok) process.exit(1);
}
