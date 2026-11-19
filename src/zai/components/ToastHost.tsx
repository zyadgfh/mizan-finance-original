// File: src/zai/components/ToastHost.tsx
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useToasts } from "../lib/toast";

export function ToastHost() {
  const items = useToasts((s) => s.items);
  if (items.length === 0) return null;
  return (
    <div className="zai-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="zai-toast">
          {t.kind === "ok" && <CheckCircle2 size={16} color="var(--zai-success)" />}
          {t.kind === "error" && <XCircle size={16} color="var(--zai-error)" />}
          {t.kind === "info" && <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
