// File: src/zai/models.ts — catalog migrated 1:1 from reference (27 models)
import type { ModelDef } from "./types";
export const MODELS: ModelDef[] = [
  { id: "gpt-5-nano", name: "GPT-5 Nano", tag: "أسرع", color: "#7ADB8F", provider: "chatly", category: "سريعة", speed: "fast", recommended: true },
  { id: "gpt-5", name: "GPT-5", tag: "رئيسي", color: "#017737", provider: "chatly", category: "موصى بها", speed: "medium", recommended: true },
  { id: "deepseek-chat", name: "DeepSeek", tag: "كود", color: "#97F7A9", provider: "chatly", category: "برمجة", speed: "medium", recommended: true },
  { id: "gemini", name: "Gemini", tag: "عام", color: "#22C55E", provider: "chatly", category: "موصى بها", speed: "fast", recommended: true },
  { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", tag: "تجريبي", color: "#B6F04C", provider: "chatly", category: "سريعة", speed: "fast" },
  { id: "openai/gpt-5", name: "GPT-5", tag: "رئيسي", color: "#B6F04C", provider: "gama", category: "موصى بها", speed: "medium" },
  { id: "openai/gpt-5.5-chat", name: "GPT-5.5 Chat", tag: "رئيسي", color: "#7ADB8F", provider: "gama", category: "تفكير", speed: "slow", thinking: true },
  { id: "openai/gpt-5-codex", name: "GPT-5 Codex", tag: "كود", color: "#017737", provider: "gama", category: "برمجة", speed: "medium" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS-120B", tag: "كود", color: "#005927", provider: "gama", category: "برمجة", speed: "medium" },
  { id: "deepseek/deepseek-v3", name: "DeepSeek V3", tag: "قياسي", color: "#97F7A9", provider: "gama", category: "برمجة", speed: "medium" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", tag: "سريع", color: "#4ADE80", provider: "gama", category: "سريعة", speed: "fast" },
  { id: "z-ai/glm-5", name: "GLM-5", tag: "قياسي", color: "#22C55E", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "z-ai/glm-5-turbo", name: "GLM-5 Turbo", tag: "سريع", color: "#B6F04C", provider: "gama", category: "سريعة", speed: "fast" },
  { id: "z-ai/glm-4.7", name: "GLM-4.7", tag: "قياسي", color: "#7ADB8F", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "z-ai/glm-4.6", name: "GLM-4.6", tag: "قياسي", color: "#017737", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "z-ai/glm-4.5", name: "GLM-4.5", tag: "قياسي", color: "#005927", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", tag: "قياسي", color: "#4ADE80", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", tag: "قياسي", color: "#22C55E", provider: "gama", category: "كل النماذج", speed: "medium" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash", tag: "تجريبي", color: "#B6F04C", provider: "gama", category: "سريعة", speed: "fast" },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", tag: "سريع", color: "#7ADB8F", provider: "gama", category: "سريعة", speed: "fast" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tag: "قياسي", color: "#017737", provider: "gama", category: "سريعة", speed: "fast" },
  { id: "perplexity/sonar", name: "Sonar", tag: "بحث", color: "#005927", provider: "gama", category: "بحث", speed: "medium" },
  { id: "perplexity/sonar-reasoning-pro", name: "Sonar Reasoning Pro", tag: "تفكير", color: "#97F7A9", provider: "gama", category: "تفكير", speed: "slow", thinking: true },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", tag: "قياسي", color: "#22C55E", provider: "gama", category: "كل النماذج", speed: "slow" },
  { id: "qwen/qwen3-coder-480b-a35b", name: "Qwen3 Coder 480B", tag: "كود", color: "#B6F04C", provider: "gama", category: "برمجة", speed: "slow" },
  { id: "qwen/qwen3-vl-235b-a22b-instruct", name: "Qwen3 VL 235B", tag: "رؤية", color: "#7ADB8F", provider: "gama", category: "رؤية", speed: "medium", vision: true },
  { id: "xai/grok-4.3", name: "Grok 4.3", tag: "قياسي", color: "#017737", provider: "gama", category: "كل النماذج", speed: "medium" },
];
export const MODEL_ALLOWLIST = new Set(MODELS.map((m) => m.id));
export const modelById = (id: string) => MODELS.find((m) => m.id === id);
export const isThinkModel = (id: string) => /thinking|reasoning|o3|o4|xhigh|chat-high|gpt-5\.5/i.test(id);
export const PROVIDER_NAME: Record<string, string> = { chatly: "مدى", gama: "رويند" };
export const SUGGESTIONS = [
  "اشرح لي مفهوم الذكاء الاصطناعي بأمثلة عراقية",
  "اكتب لي كود Python لتحميل صور من موقع",
  "خطة تسويق لموقع جديد باللغة العربية",
  "قارن بين gpt-5 و claude في البرمجة",
];
export const QUICK_CARDS = [
  { icon: "explain", title: "اشرح", prompt: "اشرح لي: " },
  { icon: "summarize", title: "لخّص", prompt: "لخّص النص التالي: " },
  { icon: "code", title: "اكتب كودًا", prompt: "اكتب كودًا يفعل: " },
  { icon: "analyze", title: "حلّل ملفًا", prompt: "حلّل الملف المرفق: " },
  { icon: "translate", title: "ترجم", prompt: "ترجم إلى العربية: " },
];
