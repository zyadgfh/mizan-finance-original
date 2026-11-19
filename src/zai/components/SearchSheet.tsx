// File: src/zai/components/SearchSheet.tsx
// Search within the current chat and across all chats. Arabic-tolerant
// (ignores tashkeel/hamza variants via lib/search normalizeArabic).
import { useMemo, useState } from "react";
import { Search, X, ChevronUp, ChevronDown, Eraser } from "lucide-react";
import { Sheet } from "./Sheet";
import { countMatches, normalizeArabic } from "../lib/search";
import { useZai } from "../lib/store";

export function SearchSheet({ open, onClose, scope, onJump }: {
  open: boolean; onClose: () => void; scope: "chat" | "all"; onJump: (chatId: string, messageId: string) => void;
}) {
  const { chats, activeId } = useZai();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);

  const pool = scope === "chat" ? chats.filter((c) => c.id === activeId) : chats.filter((c) => !c.trashed);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const out: { chatId: string; chatTitle: string; messageId: string; snippet: string; count: number }[] = [];
    for (const c of pool) {
      for (const m of c.messages) {
        const n = countMatches(m.content, q);
        if (n > 0) {
          const idx = normalizeArabic(m.content).indexOf(normalizeArabic(q));
          const snippet = m.content.slice(Math.max(0, idx - 30), idx + 60);
          out.push({ chatId: c.id, chatTitle: c.title, messageId: m.id, snippet, count: n });
        }
      }
    }
    return out;
  }, [q, pool]);

  const total = results.reduce((s, r) => s + r.count, 0);

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="search-title">
      <div className="zai-sheet-head">
        <h2 id="search-title">{scope === "chat" ? "بحث في المحادثة" : "بحث في كل المحادثات"}</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ padding: "0 16px 8px", position: "relative" }}>
        <Search size={16} style={{ position: "absolute", insetInlineStart: 28, top: 13, color: "var(--zai-text-secondary)" }} />
        <input
          autoFocus type="search" value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          placeholder="ابحث…" aria-label="نص البحث"
          style={{ width: "100%", minHeight: 40, paddingInlineStart: 36, borderRadius: 12, border: "1px solid var(--zai-outline)", background: "var(--zai-control)", color: "var(--zai-text-primary)" }}
        />
        {q && <button className="zai-icon-btn" aria-label="مسح البحث" onClick={() => setQ("")} style={{ position: "absolute", insetInlineEnd: 20, top: 5, width: 32, height: 32 }}><Eraser size={14} /></button>}
      </div>
      {q.trim() && (
        <div className="zai-search-nav">
          <span>{total} نتيجة{results.length ? ` في ${results.length} رسالة` : ""}</span>
          <div style={{ marginInlineStart: "auto", display: "flex", gap: 4 }}>
            <button className="zai-icon-btn" aria-label="السابق" style={{ width: 32, height: 32 }} disabled={!results.length} onClick={() => setCursor((c) => (c - 1 + results.length) % results.length)}><ChevronUp size={16} /></button>
            <button className="zai-icon-btn" aria-label="التالي" style={{ width: 32, height: 32 }} disabled={!results.length} onClick={() => setCursor((c) => (c + 1) % results.length)}><ChevronDown size={16} /></button>
          </div>
        </div>
      )}
      <div className="zai-sheet-body">
        {q.trim() && results.length === 0 && <p style={{ textAlign: "center", color: "var(--zai-text-secondary)", padding: 24 }}>لم يتم العثور على نتائج</p>}
        {results.map((r, i) => (
          <button key={r.chatId + r.messageId} className={`zai-menu-item ${i === cursor ? "" : ""}`}
            style={{ flexDirection: "column", alignItems: "flex-start", background: i === cursor ? "var(--zai-selection)" : undefined }}
            onClick={() => { onJump(r.chatId, r.messageId); onClose(); }}>
            {scope === "all" && <strong style={{ fontSize: 12 }}>{r.chatTitle}</strong>}
            <span style={{ fontSize: 13, color: "var(--zai-text-secondary)" }}>…{r.snippet}…</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
