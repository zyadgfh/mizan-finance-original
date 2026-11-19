// File: src/zai/components/TrashSheet.tsx
import { useState } from "react";
import { X, RotateCcw, Trash2, Inbox } from "lucide-react";
import { Sheet } from "./Sheet";
import { ConfirmDialog } from "./ConfirmDialog";
import { useZai } from "../lib/store";
import { toast } from "../lib/toast";

export function TrashSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { chats, restoreChat, hardDeleteChat } = useZai();
  const trashed = chats.filter((c) => c.trashed);
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <>
      <Sheet open={open} onClose={onClose} variant="center" labelledBy="trash-title">
        <div className="zai-sheet-head">
          <h2 id="trash-title">المهملات ({trashed.length})</h2>
          <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="zai-sheet-body">
          <p style={{ fontSize: 12, color: "var(--zai-text-secondary)", marginTop: 0 }}>
            مدة الاحتفاظ: 30 يومًا، ثم يتم التنظيف التلقائي. يمكن تعطيل التنظيف التلقائي من إعدادات الخصوصية لاحقًا.
          </p>
          {trashed.length === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: "var(--zai-text-secondary)" }}>
              <Inbox size={32} /><p>المهملات فارغة</p>
            </div>
          )}
          {trashed.map((c) => (
            <div key={c.id} className="zai-chat-item" style={{ minHeight: 52 }}>
              <span className="t">{c.title}</span>
              <button className="zai-icon-btn" aria-label={`استعادة ${c.title}`} style={{ width: 36, height: 36 }} onClick={() => { restoreChat(c.id); toast("تمت الاستعادة", "ok"); }}>
                <RotateCcw size={15} />
              </button>
              <button className="zai-icon-btn" aria-label={`حذف نهائي ${c.title}`} style={{ width: 36, height: 36 }} onClick={() => hardDeleteChat(c.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="zai-sheet-foot">
          <button className="zai-btn" disabled={!trashed.length} onClick={() => { trashed.forEach((c) => restoreChat(c.id)); toast("تمت استعادة الكل", "ok"); }}>استعادة الكل</button>
          <button className="zai-btn danger" disabled={!trashed.length} onClick={() => setConfirmAll(true)}>حذف نهائي للكل</button>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmAll} onClose={() => setConfirmAll(false)}
        onConfirm={() => { trashed.forEach((c) => hardDeleteChat(c.id)); toast("أُفرغت المهملات", "ok"); }}
        title="إفراغ المهملات" confirmLabel="حذف نهائي للكل"
        description={`سيتم حذف ${trashed.length} محادثة نهائيًا ولا يمكن التراجع عن هذا الإجراء.`}
      />
    </>
  );
}
