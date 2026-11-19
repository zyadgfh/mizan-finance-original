// File: zai/apps/api/src/models/models.catalog.ts
// Server-side allowlist of model ids — the ONLY ids messages.controller.ts
// will accept. Mirrors src/zai/models.ts in the frontend package; kept
// server-authoritative so a tampered client can never select an arbitrary
// provider/model string.
export interface ServerModelDef { id: string; name: string; provider: "chatly" | "gama"; enabled: boolean }

export const MODEL_CATALOG: ServerModelDef[] = [
  { id: "gpt-5-nano", name: "GPT-5 Nano", provider: "chatly", enabled: true },
  { id: "gpt-5", name: "GPT-5", provider: "chatly", enabled: true },
  { id: "deepseek-chat", name: "DeepSeek", provider: "chatly", enabled: true },
  { id: "gemini", name: "Gemini", provider: "chatly", enabled: true },
  { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", provider: "chatly", enabled: true },
  { id: "openai/gpt-5", name: "GPT-5", provider: "gama", enabled: true },
  { id: "openai/gpt-5-codex", name: "GPT-5 Codex", provider: "gama", enabled: true },
  { id: "deepseek/deepseek-v3", name: "DeepSeek V3", provider: "gama", enabled: true },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gama", enabled: true },
  { id: "qwen/qwen3-coder-480b-a35b", name: "Qwen3 Coder 480B", provider: "gama", enabled: true },
];

export const MODEL_ALLOWLIST = new Set(MODEL_CATALOG.filter((m) => m.enabled).map((m) => m.id));
export function isAllowedModel(id: string): boolean { return MODEL_ALLOWLIST.has(id); }
