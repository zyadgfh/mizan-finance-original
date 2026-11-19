// File: src/zai/components/MessageActionsMenu.tsx
import { useState } from "react";
import {
  Copy, FileCode2, RotateCw, Play, Sparkles, Minimize2, List, Languages,
  Volume2, Pin, Pencil, ThumbsUp, ThumbsDown, Flag, Trash2, X,
} from "lucide-react";
import { Sheet } from "./Sheet";
import { ConfirmDialog } from "./ConfirmDialog";
import { extractCodeBlocks } from "../lib/markdown";
import { useZai } from "../lib/store";
import { toast } from "../lib/toast";
import type { Message } from "../types";

export function MessageActionsMenu({
  open, onClose, anchorRef, message, chatId, onEdit, onTransform, onSpeak,
}: {
  open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null>;
  message: Message | null; chatId: string;
  onEdit: () => void; onTransform: (kind: "regenerate" | "continue" | "improve" | "simplify" | "bullets" | "translate") => void;
  onSpeak: () => void;
}) {
  const { updateMessage, removeMessage } = useZai();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mobile = typeof window !== "undefined" && window.innerWidth <= 768;
  if (!message) return null;
  const isAssistant = message.role === "assistant";

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast(label, "ok"); } catch { toast("تعذر النسخ", "error"); }
    onClose();
  };

  const rate = (r: 1 | -1) => { updateMessage(chatId, message.id, { rating: message.rating === r ? null : r }); onClose(); };

  return (
    <>
      <Sheet open={open} onClose={onClose} variant={mobile ? "bottom" : "pop"} anchorRef={anchorRef} width={300} labelledBy="msg-actions-title">
        <div className="zai-sheet-head">
          <h2 id="msg-actions-title">إجراءات الرسالة</h2>
          <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="zai-sheet-body">
          <button className="zai-menu-item" onClick={() => copy(message.content, "تم نسخ النص")}><Copy /> نسخ</button>
          <button className="zai-menu-item" onClick={() => copy(message.content, "تم نسخ Markdown")}><FileCode2 /> نسخ Markdown</button>
          <button className="zai-menu-item" onClick={() => { const blocks = extractCodeBlocks(message.content); if (!blocks.length) { toast("لا يوجد كود في هذه الرسالة"); onClose(); return; } copy(blocks.join("\n\n"), "تم نسخ الكود"); }}>
            <FileCode2 /> نسخ الكود فقط
          </button>
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("regenerate"); onClose(); }}><RotateCw /> إعادة التوليد</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("continue"); onClose(); }}><Play /> إكمال الرد</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("improve"); onClose(); }}><Sparkles /> تحسين الرد</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("simplify"); onClose(); }}><Minimize2 /> تبسيط الرد</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("bullets"); onClose(); }}><List /> تحويل إلى نقاط</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onTransform("translate"); onClose(); }}><Languages /> ترجمة الرد</button>}
          {isAssistant && <button className="zai-menu-item" onClick={() => { onSpeak(); onClose(); }}><Volume2 /> قراءة صوتية</button>}
          <button className="zai-menu-item" onClick={() => { updateMessage(chatId, message.id, { pinned: !message.pinned }); onClose(); }}>
            <Pin /> {message.pinned ? "إلغاء التثبيت" : "تثبيت الرسالة"}
          </button>
          <button className="zai-menu-item" onClick={() => { onEdit(); onClose(); }}><Pencil /> تعديل</button>
          {isAssistant && (
            <div style={{ display: "flex", gap: 6, padding: "6px 10px" }}>
              <button className={`zai-tool ${message.rating === 1 ? "on" : ""}`} aria-pressed={message.rating === 1} onClick={() => rate(1)}><ThumbsUp /> مفيد</button>
              <button className={`zai-tool ${message.rating === -1 ? "on" : ""}`} aria-pressed={message.rating === -1} onClick={() => rate(-1)}><ThumbsDown /> غير مفيد</button>
            </div>
          )}
          <button className="zai-menu-item" onClick={() => { toast("شكرًا — تم إرسال البلاغ", "ok"); onClose(); }}><Flag /> الإبلاغ عن مشكلة</button>
          <button className="zai-menu-item danger" onClick={() => setConfirmDelete(true)}><Trash2 /> حذف الرسالة</button>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)}
        onConfirm={() => { removeMessage(chatId, message.id); toast("حُذفت الرسالة", "ok"); onClose(); }}
        title="حذف الرسالة" confirmLabel="حذف"
        description="سيتم حذف هذه الرسالة من المحادثة نهائيًا."
      />
    </>
  );
}
