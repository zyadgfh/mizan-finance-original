// File: src/zai/components/OfflineDialog.tsx
// Network / reconnect dialog: distinguishes offline, server error, and quota
// exhaustion; never silently drops the user's draft text.
import { WifiOff, RotateCw, ServerCrash, Gauge } from "lucide-react";
import { Sheet } from "./Sheet";

export type ConnIssue = "offline" | "server" | "quota" | null;

export function OfflineDialog({ issue, onClose, onRetry, lastOnline }: {
  issue: ConnIssue; onClose: () => void; onRetry: () => void; lastOnline: number | null;
}) {
  if (!issue) return null;
  const cfg = {
    offline: { icon: WifiOff, title: "انقطع الاتصال بالشبكة", desc: "تابع القراءة في وضع القراءة فقط دون اتصال. مسودتك محفوظة ولن تُفقد." },
    server: { icon: ServerCrash, title: "تعذر الوصول إلى الخادم", desc: "هذا خطأ من جهة الخادم، وليس خطأ في إدخالك. أعد المحاولة بعد قليل." },
    quota: { icon: Gauge, title: "انتهت حصتك الحالية", desc: "لقد تجاوزت الحد المسموح للرسائل خلال هذه الفترة. حاول لاحقًا أو بدّل النموذج." },
  }[issue];

  return (
    <Sheet open={!!issue} onClose={onClose} variant="center" labelledBy="offline-title">
      <div className="zai-sheet-head">
        <cfg.icon size={20} color="var(--zai-error)" />
        <h2 id="offline-title">{cfg.title}</h2>
      </div>
      <div className="zai-sheet-body">
        <p style={{ margin: 0 }}>{cfg.desc}</p>
        {lastOnline && <p style={{ fontSize: 12, color: "var(--zai-text-secondary)" }}>آخر اتصال: {new Date(lastOnline).toLocaleTimeString("ar")}</p>}
      </div>
      <div className="zai-sheet-foot">
        <button className="zai-btn" onClick={onClose}>متابعة بدون اتصال</button>
        <button className="zai-btn primary" onClick={onRetry}><RotateCw size={14} /> إعادة الاتصال</button>
      </div>
    </Sheet>
  );
}
