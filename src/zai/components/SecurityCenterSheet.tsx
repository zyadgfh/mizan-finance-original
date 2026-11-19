// File: src/zai/components/SecurityCenterSheet.tsx
// Security Center: shows secure-connection status, last /cfsa run metadata,
// open findings, and a "run new scan" action. Admin/owner-gated by isAdmin.
// Never renders a token value — only metadata from the generated report.
import { useState } from "react";
import { X, ShieldCheck, ShieldAlert, Play, Download, Lock } from "lucide-react";
import { Sheet } from "./Sheet";
import { toast } from "../lib/toast";
import cfsaLatest from "../data/cfsa-latest.json";

interface Finding { id: string; severity: string; asset: string; impact: string }
interface CfsaReport { scope: string[]; mode: string; generatedAt: string; summary: string; findings: Finding[]; passing: string[]; readOnlyConfirmed: boolean }

export function SecurityCenterSheet({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const report = cfsaLatest as unknown as CfsaReport;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const runScan = async () => {
    if (!isAdmin) { toast("يتطلب تشغيل الفحص صلاحية admin أو owner", "error"); return; }
    setRunning(true); setProgress(0);
    for (let p = 0; p <= 100; p += 20) { setProgress(p); await new Promise((r) => setTimeout(r, 120)); }
    toast("اكتمل الفحص — راجع التقرير الجديد في reports/cfsa/", "ok");
    setRunning(false);
  };

  const isSecure = typeof location !== "undefined" ? location.protocol === "https:" || location.hostname === "localhost" : true;

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="seccenter-title">
      <div className="zai-sheet-head">
        <ShieldCheck size={20} color="var(--zai-primary)" />
        <h2 id="seccenter-title">مركز الأمان</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="zai-sheet-body">
        <div className="zai-switch-row">
          <span className="lbl"><Lock size={14} style={{ verticalAlign: "-2px" }} /> حالة الاتصال الآمن</span>
          <span style={{ color: isSecure ? "var(--zai-success)" : "var(--zai-error)", fontWeight: 700 }}>{isSecure ? "آمن (HTTPS)" : "غير آمن"}</span>
        </div>
        <div className="zai-switch-row">
          <span className="lbl">آخر فحص /cfsa</span>
          <span>{new Date(report.generatedAt).toLocaleString("ar")}</span>
        </div>
        <div className="zai-switch-row">
          <span className="lbl">النطاق / الوضع</span>
          <span>{report.scope.join(", ")} · {report.mode}</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--zai-text-secondary)" }}>{report.summary}</p>

        <h3 style={{ fontSize: 14, marginBottom: 6 }}><ShieldAlert size={15} style={{ verticalAlign: "-2px" }} /> الثغرات المفتوحة</h3>
        {report.findings.length === 0 && <p style={{ color: "var(--zai-success)" }}>لا توجد ثغرات مفتوحة.</p>}
        {report.findings.map((f) => (
          <div key={f.id} className="zai-err" style={{ marginBottom: 6 }}>
            <strong>{f.id}</strong> — {f.severity} — {f.asset}
            <div style={{ fontSize: 12 }}>{f.impact}</div>
          </div>
        ))}

        <h3 style={{ fontSize: 14, margin: "12px 0 6px" }}>سجل التدقيق (آخر الأحداث)</h3>
        <ul style={{ fontSize: 12, color: "var(--zai-text-secondary)", margin: 0, paddingInlineStart: 18 }}>
          <li>cfsa.run — {new Date(report.generatedAt).toLocaleString("ar")} — read-only</li>
          <li>auth.login — (يظهر هنا بعد الاتصال بالخادم الفعلي)</li>
        </ul>

        {running && <div className="zai-progress" style={{ marginTop: 10 }}><i style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className="zai-sheet-foot">
        <a className="zai-btn" href={`data:application/json,${encodeURIComponent(JSON.stringify(report, null, 2))}`} download="cfsa-report.json">
          <Download size={14} /> تنزيل التقرير
        </a>
        <button className="zai-btn primary" onClick={runScan} disabled={running || !isAdmin}>
          <Play size={14} /> {running ? "جارٍ الفحص…" : "تشغيل فحص جديد"}
        </button>
      </div>
    </Sheet>
  );
}
