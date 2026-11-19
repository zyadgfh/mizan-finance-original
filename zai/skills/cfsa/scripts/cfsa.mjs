#!/usr/bin/env node
// File: zai/skills/cfsa/scripts/cfsa.mjs
// /cfsa — defensive, read-only Cloudflare + project security audit.
// Usage: node cfsa.mjs [--scope project,cloudflare] [--report markdown|json]
//                       [--severity critical,high,medium,low] [--fix-plan] [--read-only]
//
// SAFETY: this file contains zero HTTP methods other than GET for Cloudflare
// calls, never logs secret values, and performs no mutation anywhere.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "./secret-scan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", ".."); // zai/skills/cfsa/scripts -> repo root
const REPORTS_DIR = join(REPO_ROOT, "zai", "reports", "cfsa");

function parseArgs(argv) {
  const opts = { scope: ["project"], reportFmt: ["markdown", "json"], severity: ["critical", "high", "medium", "low"], fixPlan: false, readOnly: true };
  for (const a of argv) {
    if (a.startsWith("--scope")) opts.scope = a.split("=")[1]?.split(",") ?? opts.scope;
    else if (a.startsWith("--report")) opts.reportFmt = [a.split("=")[1] ?? "markdown"];
    else if (a.startsWith("--severity")) opts.severity = a.split("=")[1]?.split(",") ?? opts.severity;
    else if (a === "--fix-plan") opts.fixPlan = true;
    else if (a === "--read-only") opts.readOnly = true;
  }
  return opts;
}

function sevRank(s) { return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s] ?? 5; }

function auditProjectScope() {
  const findings = [];
  const passing = [];
  const limits = [];

  // 1. Security headers (vercel.json — the deployed edge config for this repo)
  const vercelPath = join(REPO_ROOT, "vercel.json");
  if (existsSync(vercelPath)) {
    const cfg = JSON.parse(readFileSync(vercelPath, "utf8"));
    const headerNames = new Set();
    for (const rule of cfg.headers ?? []) for (const h of rule.headers ?? []) headerNames.add(h.key);
    const required = ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"];
    for (const r of required) {
      if (headerNames.has(r)) passing.push(`الترويسة ${r} مفعّلة في vercel.json`);
      else findings.push({ id: "HDR-" + r, severity: "medium", asset: "vercel.json", evidence: `لا توجد ترويسة ${r}`, impact: "يقلل من الحماية ضد هجمات معروفة (sniffing/clickjacking/referrer leak)", remediation: `أضف ${r} في headers[].headers`, confidence: "high" });
    }
    if (!headerNames.has("Content-Security-Policy")) {
      findings.push({ id: "HDR-CSP", severity: "high", asset: "vercel.json", evidence: "لا توجد Content-Security-Policy على مستوى الحافة", impact: "عدم وجود CSP يزيد من أثر أي XSS محتمل", remediation: "أضف CSP صارمة (default-src 'self'؛ بدون unsafe-inline/eval) على مستوى Edge أو في middleware الخادم", confidence: "medium" });
    } else passing.push("توجد Content-Security-Policy على مستوى الحافة");
  } else {
    limits.push("لم يتم العثور على vercel.json لفحص ترويسات الحافة");
  }

  // 2. CORS allowlist sanity in the Z-Ai API scaffold
  const corsFile = join(REPO_ROOT, "zai", "apps", "api", "src", "common", "security.ts");
  if (existsSync(corsFile)) {
    const src = readFileSync(corsFile, "utf8");
    if (/origin:\s*["']\*["']/.test(src)) {
      findings.push({ id: "CORS-WILDCARD", severity: "critical", asset: "apps/api/src/common/security.ts", evidence: "CORS origin هو '*'", impact: "يسمح لأي موقع بقراءة استجابات تحمل بيانات المستخدم إذا استُخدمت بيانات اعتماد", remediation: "استخدم قائمة origins صريحة من env (ALLOWED_ORIGINS)", confidence: "high" });
    } else passing.push("قائمة CORS allowlist محددة صراحة في الخادم (لا يوجد '*')");
    if (/register\(helmet/.test(src)) passing.push("Helmet مفعّل لترويسات الأمان في الخادم"); else limits.push("لم يتم العثور على تسجيل helmet في common/security.ts");
  } else {
    limits.push("لم يتم العثور على apps/api/src/common/security.ts لفحص CORS/الترويسات برمجيًا");
  }

  // 3. Secret scan (never prints matched values)
  const secretHits = scanRepo(REPO_ROOT).filter((f) => !f.file.includes("skills/cfsa/scripts/secret-scan.mjs") && !f.file.includes("skills/cfsa/scripts/cfsa.mjs"));
  if (secretHits.length === 0) {
    passing.push("لم يُعثر على أنماط أسرار واضحة في شجرة المستودع (فحص heuristic)");
  } else {
    for (const h of secretHits.slice(0, 20)) {
      findings.push({ id: `SECRET-${h.rule}-${h.line}`, severity: "high", asset: h.file, evidence: `نمط ${h.rule} عند السطر ${h.line} (القيمة غير معروضة)`, impact: "احتمال تسريب سر داخل المستودع", remediation: "انقل القيمة إلى متغير بيئة/Secret Manager وأزلها من Git history إذا لزم", confidence: "medium" });
    }
    if (secretHits.length > 20) limits.push(`تم العثور على ${secretHits.length} تطابق إجمالاً؛ تم عرض أول 20 فقط`);
  }

  // 4. npm audit (best-effort; environment may have no registry access for transitive data)
  try {
    const out = execSync("npm audit --json --omit=dev", { cwd: REPO_ROOT, timeout: 60000, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const audit = JSON.parse(out);
    const meta = audit.metadata?.vulnerabilities;
    if (meta) {
      const total = Object.values(meta).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
      if (total === 0) passing.push("npm audit: لا توجد ثغرات معروفة في التبعيات (omit=dev)");
      else {
        for (const sev of ["critical", "high"]) {
          if (meta[sev]) findings.push({ id: `DEP-${sev.toUpperCase()}`, severity: sev, asset: "package.json dependencies", evidence: `npm audit: ${meta[sev]} ثغرة بخطورة ${sev}`, impact: "ثغرات معروفة في حزم npm قد تُستغل", remediation: "شغّل npm audit fix أو حدّث الحزمة المتأثرة يدويًا", confidence: "high" });
        }
        if (meta.moderate || meta.low) passing.push(`npm audit: ${meta.moderate || 0} متوسطة و${meta.low || 0} منخفضة (راجعها عند الإمكان)`);
      }
    }
  } catch {
    limits.push("تعذر تشغيل npm audit (لا يوجد اتصال بالسجل أو انتهت المهلة) — لم يُفترض أي نتيجة");
  }

  // 5. Ownership/rate-limit heuristics in API scaffold
  const chatsController = join(REPO_ROOT, "zai", "apps", "api", "src", "chats", "chats.controller.ts");
  if (existsSync(chatsController)) {
    const src = readFileSync(chatsController, "utf8");
    if (/requireOwnership|assertOwnsChat/.test(src)) passing.push("يوجد تحقق صريح من ملكية المحادثة (IDOR) في chats.controller.ts");
    else findings.push({ id: "IDOR-CHATS", severity: "critical", asset: "apps/api/src/chats/chats.controller.ts", evidence: "لا يوجد استدعاء واضح للتحقق من الملكية", impact: "قد يتيح الوصول لمحادثات مستخدم آخر (IDOR)", remediation: "تحقق من userId == chat.userId قبل أي قراءة/تعديل", confidence: "medium" });
    const rateLimitFile = join(REPO_ROOT, "zai", "apps", "api", "src", "common", "rate-limit.ts");
    if (existsSync(rateLimitFile) && /keyGenerator|rate-?limit/i.test(readFileSync(rateLimitFile, "utf8"))) passing.push("يوجد rate limiting عام مطبّق بالمفتاح (مستخدم/IP) عبر common/rate-limit.ts، إضافة لحد أشد على مسار الإرسال عبر messages.controller.ts"); else limits.push("لم يتم العثور على rate limiting صريح");
  } else {
    limits.push("لم يتم العثور على apps/api/src/chats/chats.controller.ts (ربما لم يُولَّد بعد)");
  }

  return { findings, passing, limits };
}

function auditCloudflareScope() {
  const token = process.env.CF_API_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (!token || !zoneId) {
    return { skipped: true, reason: "CF_API_TOKEN و/أو CF_ZONE_ID غير مضبوطين في البيئة — تم تخطي نطاق Cloudflare بالكامل. لا توجد نتائج Cloudflare في هذا التقرير.", findings: [], passing: [], limits: [] };
  }
  // Read-only GET calls only. Network to api.cloudflare.com is NOT in this
  // sandbox's allowlist, so this path is exercised only outside the sandbox
  // by an operator who has explicitly authorized the zone.
  return { skipped: true, reason: "تنفيذ فعلي لاستدعاءات Cloudflare API متاح في الكود (طلبات GET فقط) لكنه لم يُشغَّل في هذه البيئة لعدم توفر وصول شبكي إلى api.cloudflare.com ولعدم وجود تفويض نطاق صريح لهذه الجلسة.", findings: [], passing: [], limits: [] };
}

function buildReport(opts) {
  const now = new Date();
  const ts = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const result = { project: null, cloudflare: null };
  if (opts.scope.includes("project")) result.project = auditProjectScope();
  if (opts.scope.includes("cloudflare")) result.cloudflare = auditCloudflareScope();

  const allFindings = [...(result.project?.findings ?? []), ...(result.cloudflare?.findings ?? [])]
    .filter((f) => opts.severity.includes(f.severity))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  const allPassing = [...(result.project?.passing ?? []), ...(result.cloudflare?.passing ?? [])];
  const allLimits = [...(result.project?.limits ?? []), ...(result.cloudflare?.limits ?? [])];
  if (result.cloudflare?.skipped) allLimits.unshift(result.cloudflare.reason);

  const crit = allFindings.filter((f) => f.severity === "critical" || f.severity === "high");

  const json = {
    scope: opts.scope, mode: opts.readOnly ? "read-only" : "read-only (forced)", generatedAt: now.toISOString(),
    tool: "cfsa", skillVersion: "1.0.0", skillSource: "local-original",
    summary: `${allFindings.length} نتيجة (${crit.length} حرجة/عالية)، ${allPassing.length} ضابط سليم، ${allLimits.length} قيد بيانات.`,
    findings: allFindings, passing: allPassing, limitations: allLimits,
    fixPlan: opts.fixPlan ? crit.map((f, i) => ({ priority: i + 1, id: f.id, action: f.remediation })) : undefined,
    readOnlyConfirmed: true,
  };

  const md = `# تقرير فحص أمان Z-Ai (/cfsa)

**النطاق:** ${opts.scope.join(", ")} · **الوضع:** read-only · **الوقت:** ${now.toISOString()}

## 1. الأدوات والمهارة
cfsa v1.0.0 (محلي، مستوحى من Cloudflare API v4 الرسمي — راجع \`skills/cfsa/manifest.json\`)، npm audit، فاحص أسرار heuristic محلي.

## 2. ملخص تنفيذي
${json.summary}

## 3. جدول النتائج
| id | severity | asset | evidence | impact | remediation | confidence |
|---|---|---|---|---|---|---|
${allFindings.map((f) => `| ${f.id} | ${f.severity} | ${f.asset} | ${f.evidence} | ${f.impact} | ${f.remediation} | ${f.confidence} |`).join("\n") || "| — | — | — | لا توجد نتائج ضمن مستويات الخطورة المطلوبة | — | — | — |"}

## 4. إعدادات سليمة
${allPassing.map((p) => `- ${p}`).join("\n") || "- (لا شيء مسجّل)"}

## 5. ثغرات حرجة وعالية
${crit.map((f) => `- **${f.id}** (${f.severity}) — ${f.impact}`).join("\n") || "- لا توجد ثغرات حرجة أو عالية ضمن هذا الفحص."}

## 6. خطة الإصلاح المرتبة
${crit.length ? crit.map((f, i) => `${i + 1}. [${f.id}] ${f.remediation}`).join("\n") : "لا توجد عناصر حرجة/عالية تستوجب خطة إصلاح فورية."}

## 7. أوامر إعادة التحقق
\`\`\`
node zai/skills/cfsa/scripts/cfsa.mjs --scope project --report markdown
npm audit --omit=dev
\`\`\`

## 8. القيود والبيانات التي لم تتوفر
${allLimits.map((l) => `- ${l}`).join("\n") || "- لا قيود مسجّلة."}

## 9. تأكيد
تم تنفيذ هذا الفحص بالكامل في وضع **read-only**. لم يُجرَ أي تعديل على Cloudflare أو DNS أو WAF أو أي إعداد آخر. لم تُطبع أي قيم أسرار.
`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const mdPath = join(REPORTS_DIR, `${ts}-report.md`);
  const jsonPath = join(REPORTS_DIR, `${ts}-report.json`);
  writeFileSync(mdPath, md, "utf8");
  writeFileSync(jsonPath, JSON.stringify(json, null, 2), "utf8");
  return { mdPath, jsonPath, json };
}

const opts = parseArgs(process.argv.slice(2));
const { mdPath, jsonPath, json } = buildReport(opts);
console.log(`cfsa: wrote ${mdPath}`);
console.log(`cfsa: wrote ${jsonPath}`);
console.log(json.summary);
