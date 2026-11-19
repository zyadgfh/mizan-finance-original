// File: src/zai/App.tsx — Z-Ai root shell
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useZai, applyTheme, newId } from "./lib/store";
import { toast } from "./lib/toast";
import { mockStream } from "./lib/mock-stream";
import { SUGGESTIONS, QUICK_CARDS } from "./models";
import type { AttachmentMeta, Message } from "./types";

import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Composer } from "./components/Composer";
import { MessageItem } from "./components/MessageItem";
import { ModelPicker } from "./components/ModelPicker";
import { MessageActionsMenu } from "./components/MessageActionsMenu";
import { SettingsSheet } from "./components/SettingsSheet";
import { AttachmentPreviewSheet } from "./components/AttachmentPreviewSheet";
import { Lightbox } from "./components/Lightbox";
import { SearchSheet } from "./components/SearchSheet";
import { TrashSheet } from "./components/TrashSheet";
import { ShareSheet } from "./components/ShareSheet";
import { ExportSheet } from "./components/ExportSheet";
import { CommandPalette } from "./components/CommandPalette";
import { OfflineDialog, type ConnIssue } from "./components/OfflineDialog";
import { SecurityCenterSheet } from "./components/SecurityCenterSheet";
import { ToastHost } from "./components/ToastHost";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ChatActionsMenu } from "./components/ChatActionsMenu";

import "./styles/tokens.css";
import "./styles/zai.css";

const DEMO_ADMIN = true; // production: derive from GET /api/v1/me role === "ADMIN"

export default function ZaiApp() {
  const { chats, activeId, settings, setSettings, addMessage, updateMessage, newChat, setOnline, online } = useZai();
  const chat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);

  useEffect(() => { applyTheme(settings); }, [settings]);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [setOnline]);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [attPreviewOpen, setAttPreviewOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState<"chat" | "all" | null>(null);
  const [shareChat, setShareChat] = useState<typeof chat>(null);
  const [exportChat, setExportChat] = useState<typeof chat>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [connIssue, setConnIssue] = useState<ConnIssue>(null);
  const [lastOnline, setLastOnline] = useState<number | null>(Date.now());
  const [renameTarget, setRenameTarget] = useState<typeof chat>(null);
  const [renameValue, setRenameValue] = useState("");
  const [chatActionsOpen, setChatActionsOpen] = useState(false);

  const [msgActions, setMsgActions] = useState<{ message: Message } | null>(null);
  const [editTriggers, setEditTriggers] = useState<Record<string, number>>({});
  const msgActionsAnchor = useRef<HTMLButtonElement | null>(null);
  const modelAnchorRef = useRef<HTMLButtonElement | null>(null);
  const chatActionsAnchorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!online) { setConnIssue("offline"); } else { setConnIssue((c) => (c === "offline" ? null : c)); setLastOnline(Date.now()); }
  }, [online]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen(true); }
      if (mod && e.key.toLowerCase() === "m") { e.preventDefault(); setModelPickerOpen(true); }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); setSearchOpen("chat"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ensureChat = (): string => (chat ? chat.id : newChat());

  const runAssistant = async (chatId: string, prompt: string, modelId: string) => {
    const assistantId = newId();
    addMessage(chatId, { id: assistantId, chatId, role: "assistant", content: "", status: "streaming", modelId, createdAt: Date.now(), updatedAt: Date.now() });
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    const start = Date.now();
    let acc = "";
    try {
      for await (const ev of mockStream(prompt, modelId, controller.signal)) {
        if (ev.type === "chunk" && ev.text) { acc += ev.text; updateMessage(chatId, assistantId, { content: acc, status: "streaming" }); }
        if (ev.type === "error") { updateMessage(chatId, assistantId, { status: "error", errorCode: ev.code ?? "unknown" }); setConnIssue("server"); break; }
      }
      const aborted = controller.signal.aborted;
      updateMessage(chatId, assistantId, { status: aborted ? "stopped" : "done", processingMs: Date.now() - start });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const send = async (text?: string, isRegenerate = false) => {
    const content = (text ?? draft).trim();
    if (!content && attachments.length === 0) return;
    const chatId = ensureChat();
    if (!isRegenerate) {
      addMessage(chatId, { id: newId(), chatId, role: "user", content, status: "done", createdAt: Date.now(), updatedAt: Date.now(), attachments: attachments.length ? attachments : undefined });
      setDraft(""); setAttachments([]);
    }
    await runAssistant(chatId, content, settings.modelId);
  };

  const stop = () => { abortRef.current?.abort(); };

  const onJumpSearch = (chatId: string, messageId: string) => {
    useZai.getState().selectChat(chatId);
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${messageId}`);
      el?.scrollIntoView({ behavior: settings.reducedMotion ? "auto" : "smooth", block: "center" });
    });
  };

  const bubbleCls = settings.bubble;
  const wide = settings.fullWidth;

  return (
    <div className="zai-root" dir="rtl" data-theme={settings.theme}>
      <Sidebar
        mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)} onOpenTrash={() => setTrashOpen(true)}
        onOpenShare={(c) => setShareChat(c)} onOpenExport={(c) => setExportChat(c)}
        onRenameChat={(c) => { setRenameTarget(c); setRenameValue(c.title); }}
      />
      <main className="zai-main">
        <Topbar
          chat={chat} onOpenSidebar={() => setSidebarOpen(true)} onOpenModelPicker={() => setModelPickerOpen(true)}
          onOpenSearch={() => setSearchOpen("chat")} onOpenChatActions={() => chat && setChatActionsOpen(true)}
          onOpenCommandPalette={() => setCmdOpen(true)} modelAnchorRef={modelAnchorRef} chatActionsAnchorRef={chatActionsAnchorRef}
        />
        <div className="zai-msgs">
          <div className={`zai-msgs-inner ${wide ? "wide" : ""}`}>
            {!chat || chat.messages.length === 0 ? (
              <div className="zai-hero">
                <h1>مرحبًا بك في Z-Ai</h1>
                <p>مساعد محادثة عربي آمن — اسأل أي شيء، أو جرّب أحد الاقتراحات.</p>
                <div className="zai-chips">
                  {SUGGESTIONS.map((s) => <button key={s} className="zai-chip" onClick={() => send(s)}>{s}</button>)}
                </div>
                <div className="zai-quick">
                  {QUICK_CARDS.map((q) => (
                    <button key={q.title} className="zai-quick-card" onClick={() => setDraft(q.prompt)}>
                      <Sparkles size={16} /><strong>{q.title}</strong>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chat.messages.map((m) => (
                <MessageItem
                  key={m.id} message={m} bubbleStyle={bubbleCls} externalEditTrigger={editTriggers[m.id]}
                  actionsAnchorRef={(el) => { if (el) msgActionsAnchor.current = el; }}
                  onOpenActions={(anchor) => { msgActionsAnchor.current = anchor; setMsgActions({ message: m }); }}
                  onRegenerate={() => { const uq = [...chat.messages].reverse().find((x) => x.role === "user"); if (uq) send(uq.content, true); }}
                  onEditSubmit={(text) => { updateMessage(chat.id, m.id, { content: text, editedAt: Date.now() }); if (m.role === "user") send(text, true); }}
                  onImageClick={(src, alt) => setLightbox({ src, alt })}
                />
              ))
            )}
          </div>
        </div>
        {attachments.length > 0 && (
          <div className={`zai-tray ${wide ? "wide" : ""}`}>
            {attachments.map((a) => (
              <span key={a.id} className="zai-att">
                {a.kind === "image" && a.dataUrl && <img src={a.dataUrl} alt={a.name} />}
                {a.name}
              </span>
            ))}
            <button className="zai-chip" onClick={() => setAttPreviewOpen(true)}>معاينة المرفقات</button>
          </div>
        )}
        <Composer
          value={draft} onChange={setDraft} onSend={() => send()} onStop={stop} streaming={streaming} wide={wide}
          onAttachFiles={(files) => { setAttachments((a) => [...a, ...files]); setAttPreviewOpen(true); }}
        />
      </main>

      <ToastHost />

      <ChatActionsMenu
        open={chatActionsOpen} onClose={() => setChatActionsOpen(false)} anchorRef={chatActionsAnchorRef} chat={chat}
        onShare={() => chat && setShareChat(chat)} onExport={() => chat && setExportChat(chat)}
        onRename={() => { if (chat) { setRenameTarget(chat); setRenameValue(chat.title); } }}
      />

      <ModelPicker open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} anchorRef={modelAnchorRef} onPick={(id) => setSettings({ modelId: id })} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TrashSheet open={trashOpen} onClose={() => setTrashOpen(false)} />
      <CommandPalette
        open={cmdOpen} onClose={() => setCmdOpen(false)} onNewChat={() => newChat()} onOpenSettings={() => setSettingsOpen(true)}
        onOpenTrash={() => setTrashOpen(true)} onOpenExport={() => chat && setExportChat(chat)} onOpenSecurity={() => setSecurityOpen(true)}
        onSetTheme={(t) => setSettings({ theme: t })} onOpenSearch={() => setSearchOpen("all")} isAdmin={DEMO_ADMIN}
      />
      <SearchSheet open={!!searchOpen} onClose={() => setSearchOpen(null)} scope={searchOpen ?? "chat"} onJump={onJumpSearch} />
      <ShareSheet open={!!shareChat} onClose={() => setShareChat(null)} chat={shareChat} />
      <ExportSheet open={!!exportChat} onClose={() => setExportChat(null)} chat={exportChat} />
      <SecurityCenterSheet open={securityOpen} onClose={() => setSecurityOpen(false)} isAdmin={DEMO_ADMIN} />
      <AttachmentPreviewSheet
        open={attPreviewOpen} onClose={() => setAttPreviewOpen(false)} items={attachments}
        onRemove={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
        onRemoveAll={() => setAttachments([])}
        onAttach={() => toast("تم تجهيز المرفقات — أرسل رسالتك", "ok")}
        onCompress={() => toast("تم ضغط الصورة", "ok")}
      />
      <Lightbox src={lightbox?.src ?? null} alt={lightbox?.alt ?? ""} onClose={() => setLightbox(null)} />
      <OfflineDialog issue={connIssue} onClose={() => setConnIssue(null)} onRetry={() => { setConnIssue(null); toast("تمت إعادة المحاولة", "ok"); }} lastOnline={lastOnline} />
      <MessageActionsMenu
        open={!!msgActions} onClose={() => setMsgActions(null)} anchorRef={msgActionsAnchor} message={msgActions?.message ?? null}
        chatId={chat?.id ?? ""}
        onEdit={() => { const id = msgActions?.message.id; if (id) setEditTriggers((t) => ({ ...t, [id]: (t[id] ?? 0) + 1 })); }}
        onSpeak={() => toast("جارٍ القراءة الصوتية…", "info")}
        onTransform={(kind) => {
          if (!chat || !msgActions) return;
          const label: Record<string, string> = { regenerate: "إعادة توليد", continue: "إكمال", improve: "تحسين", simplify: "تبسيط", bullets: "تحويل لنقاط", translate: "ترجمة" };
          toast(`${label[kind]}: جارٍ المعالجة…`, "info");
          if (kind === "regenerate") { const uq = [...chat.messages].reverse().find((x) => x.role === "user"); if (uq) send(uq.content, true); }
        }}
      />
      <ConfirmDialog
        open={!!renameTarget} onClose={() => setRenameTarget(null)}
        onConfirm={() => { if (renameTarget) useZai.getState().renameChat(renameTarget.id, renameValue || renameTarget.title); }}
        destructive={false} confirmLabel="حفظ" title="إعادة تسمية المحادثة"
        description="اختر اسمًا جديدًا لهذه المحادثة."
        meta={
          <input
            autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} aria-label="اسم المحادثة الجديد"
            style={{ width: "100%", minHeight: 40, marginTop: 6, padding: "0 10px", borderRadius: 10, border: "1px solid var(--zai-outline)", background: "var(--zai-surface)", color: "var(--zai-text-primary)" }}
          />
        }
      />
    </div>
  );
}
