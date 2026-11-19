// File: src/zai/components/ShareSheet.tsx
// Share a time-limited, read-only link. In production the backend mints a
// signed share token (`POST /api/v1/chats/:id/share`) with an expiry and
// revoke endpoint; this UI models that full lifecycle against a local stub.
import { useState } from "react";
import { X, Link2, Copy, Share2, Ban, AlertTriangle } from "lucide-react";
import { Sheet } from "./Sheet";
import { toast } from "../lib/toast";
import type { Chat } from "../types";

export function ShareSheet({ open, onClose, chat }: { open: boolean; onClose: () => void; chat: Chat | null }) {
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  if (!chat) return null;

  const create = () => {
    const token = Math.random().toString(36).slice(2, 10);
    setLink(`${location.origin}/zai/shared/${token}`);
    toast("تم إنشاء رابط مشاركة صالح لمدة 7 أيام", "ok");
  };
  const revoke = () => { setLink(null); toast("تم إلغاء الرابط", "ok"); };
  const copy = async () => { if (!link) return; await navigator.clipboard.writeText(link); toast("تم نسخ الرابط", "ok"); };
  const webShare = async () => {
    if (!link) return;
    if (navigator.share) { try { await navigator.share({ url: link, title: chat.title }); } catch { /* cancelled */ } }
    else copy();
  };

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="share-title">
      <div className="zai-sheet-head">
        <h2 id="share-title">مشاركة المحادثة</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="zai-sheet-body">
        <div className="zai-switch-row"><span className="lbl">تضمين المرفقات</span><input type="checkbox" checked={includeAttachments} onChange={(e) => setIncludeAttachments(e.target.checked)} /></div>
        <div className="zai-switch-row"><span className="lbl">رابط للقراءة فقط</span><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /></div>
        {!confirmed && (
          <div className="zai-err" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={16} color="var(--zai-error)" />
            <div>
              <p style={{ margin: 0 }}>هذه المحادثة قد تحتوي معلومات خاصة. تأكيد المشاركة يجعل الرابط متاحًا لأي شخص يملكه.</p>
              <button className="zai-btn" style={{ marginTop: 6 }} onClick={() => setConfirmed(true)}>أفهم، تابع</button>
            </div>
          </div>
        )}
        {confirmed && !link && <button className="zai-btn primary" onClick={create}><Link2 size={14} /> إنشاء رابط مشاركة</button>}
        {link && (
          <div style={{ marginTop: 12 }}>
            <input readOnly value={link} aria-label="رابط المشاركة" style={{ width: "100%" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="zai-btn" onClick={copy}><Copy size={14} /> نسخ</button>
              <button className="zai-btn" onClick={webShare}><Share2 size={14} /> مشاركة</button>
              <button className="zai-btn danger" onClick={revoke}><Ban size={14} /> إلغاء الرابط</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
