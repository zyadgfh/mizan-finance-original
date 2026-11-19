// File: src/zai/components/CommandPalette.tsx
// Ctrl/Cmd+K command palette: new chat, search commands/models/chats, open
// settings, switch theme, export, go to trash, run /cfsa (admin only).
import { useEffect, useMemo, useState } from "react";
import { Command, MessageSquarePlus, Settings as SettingsIcon, Palette, Download, Inbox, ShieldCheck, Search } from "lucide-react";
import { Sheet } from "./Sheet";
import { useZai } from "../lib/store";
import { MODELS } from "../models";
import { normalizeArabic } from "../lib/search";

interface Cmd { id: string; label: string; icon: typeof Command; run: () => void; keywords?: string }

export function CommandPalette({
  open, onClose, onNewChat, onOpenSettings, onOpenTrash, onOpenExport, onOpenSecurity, onSetTheme, onOpenSearch, isAdmin,
}: {
  open: boolean; onClose: () => void; onNewChat: () => void; onOpenSettings: () => void;
  onOpenTrash: () => void; onOpenExport: () => void; onOpenSecurity: () => void;
  onSetTheme: (t: "greenapple-dark" | "greenapple-light" | "dark" | "light") => void;
  onOpenSearch: () => void; isAdmin: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const { chats, selectChat, setSettings } = useZai();
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);

  const commands: Cmd[] = useMemo(() => {
    const base: Cmd[] = [
      { id: "new", label: "محادثة جديدة", icon: MessageSquarePlus, run: () => { onNewChat(); onClose(); } },
      { id: "settings", label: "فتح الإعدادات", icon: SettingsIcon, run: () => { onOpenSettings(); onClose(); } },
      { id: "search", label: "بحث في المحادثات", icon: Search, run: () => { onOpenSearch(); onClose(); } },
      { id: "theme-gad", label: "الثيم: Green Apple داكن", icon: Palette, run: () => { onSetTheme("greenapple-dark"); onClose(); } },
      { id: "theme-gal", label: "الثيم: Green Apple فاتح", icon: Palette, run: () => { onSetTheme("greenapple-light"); onClose(); } },
      { id: "theme-dark", label: "الثيم: داكن محايد", icon: Palette, run: () => { onSetTheme("dark"); onClose(); } },
      { id: "theme-light", label: "الثيم: فاتح محايد", icon: Palette, run: () => { onSetTheme("light"); onClose(); } },
      { id: "export", label: "تصدير المحادثة الحالية", icon: Download, run: () => { onOpenExport(); onClose(); } },
      { id: "trash", label: "الانتقال إلى المهملات", icon: Inbox, run: () => { onOpenTrash(); onClose(); } },
    ];
    if (isAdmin) base.push({ id: "cfsa", label: "تشغيل فحص الأمان /cfsa", icon: ShieldCheck, run: () => { onOpenSecurity(); onClose(); } });
    for (const m of MODELS.slice(0, 12)) {
      base.push({ id: "model-" + m.id, label: `استخدام نموذج: ${m.name}`, icon: Command, keywords: m.id, run: () => { setSettings({ modelId: m.id }); onClose(); } });
    }
    for (const c of chats.filter((c) => !c.trashed).slice(0, 20)) {
      base.push({ id: "chat-" + c.id, label: `فتح: ${c.title}`, icon: Command, run: () => { selectChat(c.id); onClose(); } });
    }
    return base;
  }, [chats, isAdmin, onClose, onOpenExport, onNewChat, onOpenSearch, onOpenSecurity, onOpenSettings, onOpenTrash, onSetTheme, selectChat, setSettings]);

  const filtered = useMemo(() => {
    const nq = normalizeArabic(q);
    if (!nq) return commands;
    return commands.filter((c) => normalizeArabic(c.label).includes(nq) || (c.keywords && c.keywords.includes(q.toLowerCase())));
  }, [commands, q]);

  useEffect(() => { setSel(0); }, [q]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === "Enter") { e.preventDefault(); filtered[sel]?.run(); }
  };

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="cmdk-title">
      <div className="zai-sheet-head">
        <Command size={18} /><h2 id="cmdk-title" style={{ fontSize: 14 }}>لوحة الأوامر</h2>
      </div>
      <div style={{ padding: "8px 16px" }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
          placeholder="اكتب أمرًا، اسم نموذج، أو محادثة…" aria-label="بحث في الأوامر"
          style={{ width: "100%", minHeight: 44, padding: "0 12px", borderRadius: 12, border: "1px solid var(--zai-outline)", background: "var(--zai-control)", color: "var(--zai-text-primary)" }} />
      </div>
      <div className="zai-sheet-body" style={{ paddingTop: 0 }} role="listbox" aria-label="نتائج الأوامر">
        {filtered.length === 0 && <p style={{ textAlign: "center", color: "var(--zai-text-secondary)" }}>لا توجد نتائج</p>}
        {filtered.slice(0, 30).map((c, i) => (
          <button key={c.id} role="option" aria-selected={i === sel} className={`zai-cmd-item ${i === sel ? "sel" : ""}`} onClick={c.run} onMouseEnter={() => setSel(i)}>
            <c.icon size={16} /> {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
