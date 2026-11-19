// File: src/zai/lib/store.ts — Zustand store (chats + settings + UI)
import { create } from "zustand";
import type { Chat, Message, ZaiSettings, AttachmentMeta } from "../types";
import { MODEL_ALLOWLIST } from "../models";

const LS_CHATS = "zai_chats_v1";
const LS_SETT = "zai_settings_v1";
const LS_FAVS = "zai_favs_v1";
const LS_USAGE = "zai_usage_v1";
const LS_LAT = "zai_lat_v1";
const LS_BAD = "zai_bad_v1";

function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota — toast handled by caller */ } }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const DEFAULT_SETTINGS: ZaiSettings = {
  theme: "greenapple-dark", modelId: "gpt-5-nano",
  systemPrompt: "Your role is that of a smart and creative assistant. Do not mention that you are a chatbot or AI assistant.",
  historyDepth: 10, fontScale: 0, glassDensity: 1, bubble: "comfort",
  reducedMotion: false, highContrast: false, reducedTransparency: false,
  fullWidth: false, compactSidebar: false,
};

interface ZaiState {
  chats: Chat[]; activeId: string | null; settings: ZaiSettings;
  favs: string[]; usage: Record<string, number>; lat: Record<string, number>; bad: string[];
  sidebarOpen: boolean; online: boolean;
  newChat: () => string; selectChat: (id: string) => void;
  renameChat: (id: string, title: string) => void; deleteChat: (id: string) => void;
  restoreChat: (id: string) => void; hardDeleteChat: (id: string) => void;
  duplicateChat: (id: string) => void; togglePinChat: (id: string) => void;
  toggleArchiveChat: (id: string) => void; setGroup: (id: string, g: string) => void;
  addMessage: (chatId: string, m: Message) => void; updateMessage: (chatId: string, mid: string, patch: Partial<Message>) => void;
  removeMessage: (chatId: string, mid: string) => void;
  setSettings: (p: Partial<ZaiSettings>) => void;
  toggleFav: (id: string) => void; bumpUsage: (id: string) => void;
  setLat: (id: string, ms: number) => void; markBad: (id: string, on: boolean) => void;
  setSidebar: (open: boolean) => void; setOnline: (o: boolean) => void;
  importChats: (chats: Chat[]) => void;
}

export const useZai = create<ZaiState>((set, get) => ({
  chats: load<Chat[]>(LS_CHATS, []),
  activeId: null,
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<ZaiSettings>>(LS_SETT, {}) },
  favs: load<string[]>(LS_FAVS, []), usage: load<Record<string, number>>(LS_USAGE, {}),
  lat: load<Record<string, number>>(LS_LAT, {}), bad: load<string[]>(LS_BAD, []),
  sidebarOpen: false, online: navigator.onLine,
  newChat: () => {
    const id = uid();
    const chat: Chat = { id, title: "محادثة جديدة", modelId: get().settings.modelId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    set((s) => { const chats = [chat, ...s.chats]; save(LS_CHATS, chats); return { chats, activeId: id }; });
    return id;
  },
  selectChat: (id) => set({ activeId: id }),
  renameChat: (id, title) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)); save(LS_CHATS, chats); return { chats }; }),
  deleteChat: (id) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, trashed: true, updatedAt: Date.now() } : c)); save(LS_CHATS, chats); return { chats, activeId: s.activeId === id ? null : s.activeId }; }),
  restoreChat: (id) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, trashed: false, archived: false } : c)); save(LS_CHATS, chats); return { chats }; }),
  hardDeleteChat: (id) => set((s) => { const chats = s.chats.filter((c) => c.id !== id); save(LS_CHATS, chats); return { chats, activeId: s.activeId === id ? null : s.activeId }; }),
  duplicateChat: (id) => {
    const src = get().chats.find((c) => c.id === id); if (!src) return;
    const nid = uid();
    const copy: Chat = { ...src, id: nid, title: src.title + " (نسخة)", createdAt: Date.now(), updatedAt: Date.now(), messages: src.messages.map((m) => ({ ...m, id: uid(), chatId: nid })) };
    set((s) => { const chats = [copy, ...s.chats]; save(LS_CHATS, chats); return { chats, activeId: nid }; });
  },
  togglePinChat: (id) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)); save(LS_CHATS, chats); return { chats }; }),
  toggleArchiveChat: (id) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, archived: !c.archived } : c)); save(LS_CHATS, chats); return { chats }; }),
  setGroup: (id, g) => set((s) => { const chats = s.chats.map((c) => (c.id === id ? { ...c, group: g || undefined } : c)); save(LS_CHATS, chats); return { chats }; }),
  addMessage: (chatId, m) => set((s) => { const chats = s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, m], updatedAt: Date.now(), title: c.title === "محادثة جديدة" && m.role === "user" ? m.content.slice(0, 40) : c.title } : c)); save(LS_CHATS, chats); return { chats }; }),
  updateMessage: (chatId, mid, patch) => set((s) => { const chats = s.chats.map((c) => (c.id === chatId ? { ...c, messages: c.messages.map((m) => (m.id === mid ? { ...m, ...patch, updatedAt: Date.now() } : m)) } : c)); save(LS_CHATS, chats); return { chats }; }),
  removeMessage: (chatId, mid) => set((s) => { const chats = s.chats.map((c) => (c.id === chatId ? { ...c, messages: c.messages.filter((m) => m.id !== mid) } : c)); save(LS_CHATS, chats); return { chats }; }),
  setSettings: (p) => set((s) => {
    const next = { ...s.settings, ...p };
    if (p.modelId && !MODEL_ALLOWLIST.has(p.modelId)) return s; // server allowlist mirror
    save(LS_SETT, next); return { settings: next };
  }),
  toggleFav: (id) => set((s) => { const favs = s.favs.includes(id) ? s.favs.filter((f) => f !== id) : [...s.favs, id]; save(LS_FAVS, favs); return { favs }; }),
  bumpUsage: (id) => set((s) => { const usage = { ...s.usage, [id]: (s.usage[id] || 0) + 1 }; save(LS_USAGE, usage); return { usage }; }),
  setLat: (id, ms) => set((s) => { const lat = { ...s.lat, [id]: ms }; save(LS_LAT, lat); return { lat }; }),
  markBad: (id, on) => set((s) => { const bad = on ? [...new Set([...s.bad, id])] : s.bad.filter((b) => b !== id); save(LS_BAD, bad); return { bad }; }),
  setSidebar: (open) => set({ sidebarOpen: open }),
  setOnline: (o) => set({ online: o }),
  importChats: (chats) => set((s) => { const merged = [...chats, ...s.chats]; save(LS_CHATS, merged); return { chats: merged }; }),
}));
export const newId = uid;
export const applyTheme = (s: ZaiSettings) => {
  const root = document.documentElement;
  root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-contrast", s.highContrast ? "high" : "normal");
  root.setAttribute("data-reduced-transparency", s.reducedTransparency ? "true" : "false");
  root.style.fontSize = `${16 + s.fontScale * 1.5}px`;
};
export type { AttachmentMeta };
