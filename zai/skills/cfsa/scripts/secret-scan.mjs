#!/usr/bin/env node
// File: zai/skills/cfsa/scripts/secret-scan.mjs
// Read-only heuristic secret scanner used by cfsa.mjs. Never prints matched
// secret values — only file, line number, and the rule that fired.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RULES = [
  { id: "aws-key", re: /AKIA[0-9A-Z]{16}/ },
  { id: "generic-api-key", re: /(api[_-]?key|secret[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i },
  { id: "openai-key", re: /sk-[A-Za-z0-9]{20,}/ },
  { id: "private-key-block", re: /-----BEGIN (RSA |EC |)PRIVATE KEY-----/ },
  { id: "jwt-looking", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: "slack-token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { id: "cf-token-pattern", re: /CF_API_TOKEN\s*=\s*[A-Za-z0-9_-]{20,}/ },
];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".output", ".vercel", ".nitro", "coverage", "native-dist"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".env", ".yml", ".yaml", ".md", ".css", ".html"]);

export function scanRepo(root) {
  const findings = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = "." + (e.name.split(".").pop() || "");
      if (!TEXT_EXT.has(ext) && !e.name.startsWith(".env")) continue;
      let content;
      try { content = readFileSync(full, "utf8"); } catch { continue; }
      if (content.length > 2_000_000) continue;
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.re.test(line)) {
            findings.push({ file: relative(root, full), line: i + 1, rule: rule.id });
          }
        }
      });
    }
  }
  walk(root);
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || process.cwd();
  const stat = statSync(root);
  if (!stat.isDirectory()) { console.error("root must be a directory"); process.exit(1); }
  const findings = scanRepo(root);
  console.log(JSON.stringify(findings, null, 2));
}
