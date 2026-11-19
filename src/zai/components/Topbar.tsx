// File: src/zai/components/Topbar.tsx
import { Menu, ChevronDown, Search, MoreHorizontal, Command } from "lucide-react";
import type { Chat } from "../types";
import { modelById } from "../models";

export function Topbar({
  chat, onOpenSidebar, onOpenModelPicker, onOpenSearch, onOpenChatActions, onOpenCommandPalette, modelAnchorRef, chatActionsAnchorRef,
}: {
  chat: Chat | null; onOpenSidebar: () => void; onOpenModelPicker: () => void; onOpenSearch: () => void;
  onOpenChatActions: () => void; onOpenCommandPalette: () => void;
  modelAnchorRef: React.RefObject<HTMLButtonElement | null>; chatActionsAnchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const model = chat ? modelById(chat.modelId) : undefined;
  return (
    <header className="zai-topbar">
      <button className="zai-icon-btn zai-menu-toggle" aria-label="فتح قائمة المحادثات" onClick={onOpenSidebar}><Menu size={19} /></button>
      <h1 className="zai-ttl">{chat?.title ?? "Z-Ai"}</h1>
      <button ref={modelAnchorRef} className="zai-model-pill" onClick={onOpenModelPicker} aria-haspopup="dialog">
        {model && <span style={{ width: 8, height: 8, borderRadius: "50%", background: model.color, flex: "none" }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model?.name ?? "اختر نموذجًا"}</span>
        <ChevronDown size={14} />
      </button>
      <button className="zai-icon-btn" aria-label="بحث في المحادثة" onClick={onOpenSearch}><Search size={18} /></button>
      <button className="zai-icon-btn" aria-label="لوحة الأوامر" onClick={onOpenCommandPalette}><Command size={18} /></button>
      <button ref={chatActionsAnchorRef} className="zai-icon-btn" aria-label="المزيد من الإجراءات" onClick={onOpenChatActions} disabled={!chat}>
        <MoreHorizontal size={18} />
      </button>
    </header>
  );
}
