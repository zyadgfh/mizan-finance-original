// File: src/zai/components/MessageItem.tsx
import { useEffect, useRef, useState } from "react";
import { Copy, MoreHorizontal, Pencil, RotateCw, Volume2, ThumbsUp, ThumbsDown, Pin, Check, X } from "lucide-react";
import { renderMarkdownSafe } from "../lib/markdown";
import { modelById, PROVIDER_NAME } from "../models";
import { processingLabel } from "../lib/mock-stream";
import { toast } from "../lib/toast";
import type { Message } from "../types";

export function MessageItem({
  message, bubbleStyle, onOpenActions, onRegenerate, onEditSubmit, onImageClick, actionsAnchorRef, externalEditTrigger,
}: {
  message: Message; bubbleStyle: "comfort" | "compact" | "plain";
  onOpenActions: (anchor: HTMLButtonElement) => void; onRegenerate: () => void;
  onEditSubmit: (text: string) => void; onImageClick: (src: string, alt: string) => void;
  actionsAnchorRef: (el: HTMLButtonElement | null) => void;
  /** Bumped by the parent (e.g. from the Message Actions popover's "تعديل")
   * to open inline editing for this message without lifting full edit state. */
  externalEditTrigger?: number;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (externalEditTrigger) setEditing(true); }, [externalEditTrigger]);
  const [draft, setDraft] = useState(message.content);
  const model = message.modelId ? modelById(message.modelId) : undefined;
  const html = renderMarkdownSafe(message.content || (message.status === "streaming" ? "" : ""));
  const bodyRef = useRef<HTMLDivElement>(null);

  const onBodyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") onImageClick((target as HTMLImageElement).src, (target as HTMLImageElement).alt);
  };

  const copy = async () => { await navigator.clipboard.writeText(message.content); toast("تم النسخ", "ok"); };

  return (
    <div id={`msg-${message.id}`} className={`zai-msg ${message.role} ${message.pinned ? "pinned" : ""}`}>
      <div className="zai-who">
        {message.role === "assistant" ? (model?.name ?? "المساعد") : "أنت"}
        {message.role === "assistant" && model && <span>· {PROVIDER_NAME[model.provider]}</span>}
        {message.status === "streaming" && <span>· يكتب الآن…</span>}
        {message.status === "error" && <span style={{ color: "var(--zai-error)" }}>· فشل الإرسال</span>}
        {message.status === "stopped" && <span>· تم الإيقاف</span>}
        {message.processingMs != null && message.status === "done" && <span>· {processingLabel(message.processingMs)}</span>}
      </div>

      {editing ? (
        <div style={{ width: "100%", maxWidth: 560 }}>
          <textarea className="zai-input" style={{ width: "100%" }} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="تعديل الرسالة" autoFocus />
          <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
            <button className="zai-btn" onClick={() => { setDraft(message.content); setEditing(false); }}><X size={14} /> إلغاء</button>
            <button className="zai-btn primary" onClick={() => { onEditSubmit(draft); setEditing(false); }}><Check size={14} /> حفظ وإرسال</button>
          </div>
        </div>
      ) : (
        <div className={`zai-bubble ${bubbleStyle}`}>
          {message.attachments && message.attachments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {message.attachments.map((a) => a.kind === "image" && a.dataUrl ? (
                <img key={a.id} src={a.dataUrl} alt={a.name} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, cursor: "zoom-in" }}
                  onClick={() => onImageClick(a.dataUrl!, a.name)} />
              ) : <span key={a.id} className="zai-att">{a.name}</span>)}
            </div>
          )}
          <div ref={bodyRef} className="zai-md" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
          {message.status === "streaming" && (
            <div className="zai-typing" aria-label="جارٍ إنشاء الإجابة"><i /><i /><i /></div>
          )}
        </div>
      )}

      {!editing && message.status !== "streaming" && (
        <div className="zai-actions">
          <button className="zai-tool" onClick={copy}><Copy /> نسخ</button>
          {message.role === "assistant" && <button className="zai-tool" onClick={onRegenerate}><RotateCw /> إعادة التوليد</button>}
          {message.role === "assistant" && <button className="zai-tool"><Volume2 /> استماع</button>}
          <button className="zai-tool" onClick={() => setEditing(true)}><Pencil /> تعديل</button>
          {message.role === "assistant" && (
            <>
              <button className={`zai-tool ${message.rating === 1 ? "on" : ""}`} aria-pressed={message.rating === 1}><ThumbsUp /></button>
              <button className={`zai-tool ${message.rating === -1 ? "on" : ""}`} aria-pressed={message.rating === -1}><ThumbsDown /></button>
            </>
          )}
          {message.pinned && <Pin size={13} style={{ color: "var(--zai-primary)" }} aria-label="مثبّتة" />}
          <button ref={actionsAnchorRef} className="zai-tool" aria-label="مزيد من الإجراءات" onClick={(e) => onOpenActions(e.currentTarget)}><MoreHorizontal /></button>
        </div>
      )}
    </div>
  );
}
