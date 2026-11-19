// File: src/zai/components/ConfirmDialog.tsx
// Generic accessible confirmation dialog — replaces window.confirm() everywhere,
// used directly for the mandatory "Delete Confirmation Dialog" spec item.
import { AlertTriangle } from "lucide-react";
import { Sheet } from "./Sheet";

export function ConfirmDialog({
  open, onClose, onConfirm, title, description, destructive = true,
  confirmLabel = "حذف", cancelLabel = "إلغاء", meta,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; description: string; destructive?: boolean;
  confirmLabel?: string; cancelLabel?: string; meta?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="confirm-title">
      <div className="zai-sheet-head">
        <AlertTriangle size={20} color={destructive ? "var(--zai-error)" : "var(--zai-primary)"} />
        <h2 id="confirm-title">{title}</h2>
      </div>
      <div className="zai-sheet-body">
        <p style={{ margin: 0, fontSize: "var(--zai-font-base)", color: "var(--zai-text-secondary)" }}>{description}</p>
        {meta && <p style={{ marginTop: 8, fontSize: "var(--zai-font-sm)" }}>{meta}</p>}
        {destructive && (
          <p style={{ marginTop: 10, fontSize: "var(--zai-font-xs)", color: "var(--zai-error)" }}>
            هذا الإجراء قد لا يكون قابلًا للتراجع فورًا — يمكن استعادته من المهملات إن لم يكن حذفًا نهائيًا.
          </p>
        )}
      </div>
      <div className="zai-sheet-foot">
        <button className="zai-btn" onClick={onClose} autoFocus>{cancelLabel}</button>
        <button className={`zai-btn ${destructive ? "danger" : "primary"}`} onClick={() => { onConfirm(); onClose(); }}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
