// File: src/zai/components/ExportSheet.tsx
import { useState } from "react";
import { X, FileText, FileJson, FileCode, FileDown } from "lucide-react";
import { Sheet } from "./Sheet";
import { renderMarkdownSafe } from "../lib/markdown";
import { toast } from "../lib/toast";
import type { Chat } from "../types";

type Fmt = "md" | "html" | "json" | "pdf";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function ExportSheet({ open, onClose, chat }: { open: boolean; onClose: () => void; chat: Chat | null }) {
  const [fmt, setFmt] = useState<Fmt>("md");
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [includeAtt, setIncludeAtt] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  if (!chat) return null;

  const run = async () => {
    setProgress(10);
    const messages = scope === "all" ? chat.messages : chat.messages.filter((m) => m.pinned);
    await new Promise((r) => setTimeout(r, 150)); setProgress(45);
    if (fmt === "md") {
      const md = messages.map((m) => `**${m.role === "user" ? "أنت" : "المساعد"}:**\n\n${m.content}\n`).join("\n---\n\n");
      download(`${chat.title}.md`, md, "text/markdown");
    } else if (fmt === "json") {
      download(`${chat.title}.json`, JSON.stringify({ chat: { ...chat, messages } }, null, 2), "application/json");
    } else if (fmt === "html") {
      const body = messages.map((m) => `<section><h3>${m.role === "user" ? "أنت" : "المساعد"}</h3>${renderMarkdownSafe(m.content)}</section>`).join("\n");
      download(`${chat.title}.html`, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${chat.title}</title><body>${body}</body></html>`, "text/html");
    } else if (fmt === "pdf") {
      // Print-to-PDF path: open a print-ready document the OS can save as PDF
      // without pulling a heavy PDF-generation dependency into the bundle.
      const body = messages.map((m) => `<section><h3>${m.role === "user" ? "أنت" : "المساعد"}</h3>${renderMarkdownSafe(m.content)}</section>`).join("\n");
      const w = window.open("", "_blank");
      if (w) { w.document.write(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${chat.title}</title><body>${body}</body></html>`); w.document.close(); w.print(); }
    }
    await new Promise((r) => setTimeout(r, 150)); setProgress(100);
    toast("اكتمل التصدير", "ok");
    setTimeout(() => { setProgress(null); onClose(); }, 400);
  };

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="export-title">
      <div className="zai-sheet-head">
        <h2 id="export-title">تصدير المحادثة</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="zai-sheet-body">
        <div className="zai-field">
          <label>الصيغة</label>
          <div className="zai-seg">
            <button className={fmt === "md" ? "cur" : ""} onClick={() => setFmt("md")}><FileText size={14} /> Markdown</button>
            <button className={fmt === "html" ? "cur" : ""} onClick={() => setFmt("html")}><FileCode size={14} /> HTML</button>
            <button className={fmt === "json" ? "cur" : ""} onClick={() => setFmt("json")}><FileJson size={14} /> JSON</button>
            <button className={fmt === "pdf" ? "cur" : ""} onClick={() => setFmt("pdf")}><FileDown size={14} /> PDF</button>
          </div>
        </div>
        <div className="zai-field">
          <label>النطاق</label>
          <div className="zai-seg">
            <button className={scope === "all" ? "cur" : ""} onClick={() => setScope("all")}>المحادثة كاملة</button>
            <button className={scope === "selection" ? "cur" : ""} onClick={() => setScope("selection")}>الرسائل المثبّتة فقط</button>
          </div>
        </div>
        <div className="zai-switch-row"><span className="lbl">تضمين المرفقات (وصف فقط — بدون بيانات ثنائية)</span><input type="checkbox" checked={includeAtt} onChange={(e) => setIncludeAtt(e.target.checked)} /></div>
        {progress != null && <div className="zai-progress" style={{ marginTop: 12 }}><i style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className="zai-sheet-foot">
        <button className="zai-btn" onClick={onClose}>إلغاء</button>
        <button className="zai-btn primary" onClick={run} disabled={progress != null}>تصدير</button>
      </div>
    </Sheet>
  );
}
