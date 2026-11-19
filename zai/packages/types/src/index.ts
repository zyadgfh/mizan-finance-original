// File: zai/packages/types/src/index.ts — mirror of src/zai/types.ts (keep both in sync; see package.json)
export type ZaiTheme = "greenapple-dark" | "greenapple-light" | "dark" | "light";
export type Role = "user" | "assistant" | "system";
export type MsgStatus = "pending" | "streaming" | "done" | "error" | "stopped";
export type Rating = 1 | -1 | null;

export interface AttachmentMeta {
  id: string; name: string; kind: "image" | "file"; mime: string;
  size: number; dataUrl?: string; // local preview only; backend uses object storage
  scan: "ok" | "blocked" | "pending";
}
export interface Message {
  id: string; chatId: string; role: Role; content: string;
  modelId?: string; status: MsgStatus; errorCode?: string | null;
  createdAt: number; updatedAt: number; editedAt?: number | null;
  pinned?: boolean; rating?: Rating; attachments?: AttachmentMeta[];
  processingMs?: number; // safe summary only — never raw chain-of-thought
}
export interface Chat {
  id: string; title: string; modelId: string; group?: string;
  pinned?: boolean; archived?: boolean; trashed?: boolean;
  createdAt: number; updatedAt: number; messages: Message[];
}
export interface ZaiSettings {
  theme: ZaiTheme; modelId: string; systemPrompt: string;
  historyDepth: number; fontScale: number; // -1..2
  glassDensity: 0 | 1 | 2; bubble: "comfort" | "compact" | "plain";
  reducedMotion: boolean; highContrast: boolean; reducedTransparency: boolean;
  fullWidth: boolean; compactSidebar: boolean;
}
export interface ModelDef {
  id: string; name: string; tag: string; color: string;
  provider: "chatly" | "gama"; category: string;
  speed: "fast" | "medium" | "slow"; vision?: boolean; thinking?: boolean;
  recommended?: boolean;
}
