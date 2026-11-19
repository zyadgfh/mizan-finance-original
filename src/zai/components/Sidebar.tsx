// File: src/zai/components/Sidebar.tsx
import { useMemo, useState, useRef } from "react";
import { Plus, Search, MoreHorizontal, Pin, Wifi, WifiOff, Settings, Inbox, PanelLeft } from "lucide-react";
import { useZai } from "../lib/store";
import { matchesQuery } from "../lib/search";
import { ChatActionsMenu } from "./ChatActionsMenu";
import type { Chat } from "../types";

export function Sidebar({
  onOpenSettings, onOpenTrash, onOpenShare, onOpenExport, onRenameChat, mobileOpen, onCloseMobile,
}: {
  onOpenSettings: () => void; onOpenTrash: () => void;
  onOpenShare: (c: Chat) => void; onOpenExport: (c: Chat) => void; onRenameChat: (c: Chat) => void;
  mobileOpen: boolean; onCloseMobile: () => void;
}) {
  const { chats, activeId, selectChat, newChat, online } = useZai();
  const [q, setQ] = useState("");
  const [menuChat, setMenuChat] = useState<Chat | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(() => {
    const list = chats.filter((c) => !c.trashed && !c.archived && (!q || matchesQuery(c.title, q)));
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [chats, q]);

  return (
    <aside className={`zai-sidebar ${mobileOpen ? "open" : ""}`} aria-label="قائمة المحادثات">
      <div className="zai-side-head">
        <div className="zai-logo">Z</div>
        <div className="zai-brand"><b>Z-Ai</b><span>مساعد المحادثة العربي</span></div>
        <button className="zai-icon-btn zai-menu-toggle" aria-label="إغلاق القائمة" onClick={onCloseMobile}><PanelLeft size={18} /></button>
      </div>
      <button className="zai-btn-new" onClick={() => newChat()}>
        <Plus size={18} /> محادثة جديدة
      </button>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", insetInlineStart: 28, top: 10, color: "var(--zai-text-secondary)" }} />
        <input className="zai-search" style={{ paddingInlineStart: 30 }} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في المحادثات…" aria-label="بحث في المحادثات" />
      </div>
      <nav className="zai-chat-list">
        {visible.length === 0 && <p style={{ textAlign: "center", color: "var(--zai-text-secondary)", fontSize: 13, padding: 16 }}>لا توجد محادثات</p>}
        {visible.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center" }}>
            <button className={`zai-chat-item ${activeId === c.id ? "active" : ""}`} onClick={() => selectChat(c.id)} aria-current={activeId === c.id}>
              {c.pinned && <Pin size={13} />}
              <span className="t">{c.title}</span>
            </button>
            <button ref={activeId === c.id ? anchorRef : undefined} className="zai-icon-btn" style={{ width: 34, height: 34 }} aria-label={`خيارات ${c.title}`} onClick={(e) => { anchorRef.current = e.currentTarget; setMenuChat(c); }}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        ))}
      </nav>
      <div className="zai-side-foot">
        <span className="zai-status">
          <span className={`zai-dot ${online ? "" : "off"}`} aria-hidden="true" />
          {online ? <><Wifi size={13} /> متصل</> : <><WifiOff size={13} /> غير متصل</>}
        </span>
        <button className="zai-icon-btn" aria-label="المهملات" onClick={onOpenTrash}><Inbox size={18} /></button>
        <button className="zai-icon-btn" aria-label="الإعدادات" onClick={onOpenSettings}><Settings size={18} /></button>
      </div>
      <ChatActionsMenu
        open={!!menuChat} onClose={() => setMenuChat(null)} anchorRef={anchorRef} chat={menuChat}
        onShare={() => menuChat && onOpenShare(menuChat)} onExport={() => menuChat && onOpenExport(menuChat)}
        onRename={() => menuChat && onRenameChat(menuChat)}
      />
    </aside>
  );
}
