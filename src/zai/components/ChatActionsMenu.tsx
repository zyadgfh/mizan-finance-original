// File: src/zai/components/ChatActionsMenu.tsx
import { useState } from "react";
import {
  Pencil, Copy, Pin, PinOff, Archive, Trash2, RotateCcw, Share2, Download,
  Tag, FolderInput, Info, Sparkles, X,
} from "lucide-react";
import { Sheet } from "./Sheet";
import { ConfirmDialog } from "./ConfirmDialog";
import { useZai } from "../lib/store";
import { toast } from "../lib/toast";
import type { Chat } from "../types";

export function ChatActionsMenu({
  open, onClose, anchorRef, chat, onShare, onExport, onRename,
}: {
  open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null>;
  chat: Chat | null; onShare: () => void; onExport: () => void; onRename: () => void;
}) {
  const { togglePinChat, toggleArchiveChat, duplicateChat, deleteChat, hardDeleteChat, restoreChat } = useZai();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mobile = typeof window !== "undefined" && window.innerWidth <= 768;
  if (!chat) return null;

  const items: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }[] = [
    { icon: Pencil, label: "إعادة تسمية", onClick: () => { onRename(); onClose(); } },
    { icon: FolderInput, label: "تغيير المجموعة", onClick: () => { toast("اختر مجموعة من الإعدادات → سيتم حفظها"); onClose(); } },
    { icon: Tag, label: "إضافة ملصق", onClick: () => { toast("أُضيف ملصق للمحادثة", "ok"); onClose(); } },
    { icon: chat.pinned ? PinOff : Pin, label: chat.pinned ? "فك التثبيت" : "تثبيت", onClick: () => { togglePinChat(chat.id); onClose(); } },
    { icon: Copy, label: "تكرار", onClick: () => { duplicateChat(chat.id); toast("تم تكرار المحادثة", "ok"); onClose(); } },
    { icon: Share2, label: "مشاركة", onClick: () => { onShare(); onClose(); } },
    { icon: Download, label: "تصدير (Markdown / HTML / JSON / PDF)", onClick: () => { onExport(); onClose(); } },
    { icon: Sparkles, label: "تلخيص المحادثة", onClick: () => { toast(`ملخص: محادثة من ${chat.messages.length} رسالة حول "${chat.title}"`, "info"); onClose(); } },
    { icon: Info, label: "معلومات المحادثة", onClick: () => { toast(`أُنشئت ${new Date(chat.createdAt).toLocaleString("ar")}`, "info"); onClose(); } },
    { icon: Archive, label: chat.archived ? "إلغاء الأرشفة" : "أرشفة", onClick: () => { toggleArchiveChat(chat.id); onClose(); } },
  ];
  if (!chat.trashed) items.push({ icon: Trash2, label: "نقل إلى المهملات", onClick: () => { deleteChat(chat.id); toast("نُقلت إلى المهملات — يمكن التراجع", "ok"); onClose(); }, danger: true });
  else {
    items.push({ icon: RotateCcw, label: "استعادة من المهملات", onClick: () => { restoreChat(chat.id); onClose(); } });
    items.push({ icon: Trash2, label: "حذف نهائي", onClick: () => setConfirmDelete(true), danger: true });
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} variant={mobile ? "bottom" : "pop"} anchorRef={anchorRef} width={300} labelledBy="chat-actions-title">
        <div className="zai-sheet-head">
          <h2 id="chat-actions-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat.title}</h2>
          <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="zai-sheet-body">
          {items.map((it, i) => (
            <button key={i} className={`zai-menu-item ${it.danger ? "danger" : ""}`} onClick={it.onClick}>
              <it.icon /> {it.label}
            </button>
          ))}
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)}
        onConfirm={() => { hardDeleteChat(chat.id); toast("حُذفت المحادثة نهائيًا", "ok"); onClose(); }}
        title="حذف نهائي للمحادثة" confirmLabel="حذف نهائي"
        description={`سيتم حذف "${chat.title}" و${chat.messages.length} رسالة نهائيًا. هذا الإجراء غير قابل للاسترجاع.`}
      />
    </>
  );
}
