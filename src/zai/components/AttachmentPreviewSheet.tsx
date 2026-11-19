// File: src/zai/components/AttachmentPreviewSheet.tsx
import { X, Trash2, FileText, ImageIcon, CheckCircle2, AlertTriangle, Wand2 } from "lucide-react";
import { Sheet } from "./Sheet";
import { formatBytes } from "../lib/files";
import type { AttachmentMeta } from "../types";

export function AttachmentPreviewSheet({
  open, onClose, items, onRemove, onRemoveAll, onAttach, onCompress,
}: {
  open: boolean; onClose: () => void; items: AttachmentMeta[];
  onRemove: (id: string) => void; onRemoveAll: () => void; onAttach: () => void; onCompress: (id: string) => void;
}) {
  const mobile = typeof window !== "undefined" && window.innerWidth <= 768;
  return (
    <Sheet open={open} onClose={onClose} variant={mobile ? "bottom" : "center"} labelledBy="att-title">
      <div className="zai-sheet-head">
        <h2 id="att-title">معاينة المرفقات ({items.length})</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="zai-sheet-body">
        {items.length === 0 && <p style={{ textAlign: "center", color: "var(--zai-text-secondary)" }}>لا توجد مرفقات بعد</p>}
        {items.map((a) => (
          <div key={a.id} className="zai-att" style={{ width: "100%", marginBottom: 8 }}>
            {a.kind === "image" && a.dataUrl ? <img src={a.dataUrl} alt={a.name} /> : <FileText size={28} />}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{a.name}</div>
              <div style={{ color: "var(--zai-text-secondary)" }}>{a.mime || "نوع غير معروف"} · {formatBytes(a.size)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                {a.scan === "ok" && <><CheckCircle2 size={13} color="var(--zai-success)" /> تم الفحص</>}
                {a.scan === "pending" && <>جارٍ الفحص…</>}
                {a.scan === "blocked" && <><AlertTriangle size={13} color="var(--zai-error)" /> نوع غير مدعوم</>}
              </div>
            </div>
            {a.kind === "image" && (
              <button className="zai-icon-btn" aria-label="ضغط الصورة" onClick={() => onCompress(a.id)}><Wand2 size={16} /></button>
            )}
            <button className="zai-icon-btn" aria-label={`إزالة ${a.name}`} onClick={() => onRemove(a.id)}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="zai-sheet-foot">
        <button className="zai-btn" onClick={onRemoveAll} disabled={items.length === 0}>إزالة الكل</button>
        <button className="zai-btn" onClick={onClose}>إلغاء</button>
        <button className="zai-btn primary" onClick={() => { onAttach(); onClose(); }} disabled={items.some((i) => i.scan === "blocked")}>
          <ImageIcon size={14} /> إرفاق
        </button>
      </div>
    </Sheet>
  );
}
