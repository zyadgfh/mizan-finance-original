// File: src/zai/lib/mock-stream.ts
// Local demo transport. Production: POST /api/v1/chats/:id/messages/stream (SSE)
// via the Z-Ai backend — NO provider keys in the frontend. This mock simulates
// SSE chunking so the UI (streaming, stop, retry) is fully testable offline.
export interface StreamEvent { type: "chunk" | "done" | "error"; text?: string; code?: string }
export async function* mockStream(prompt: string, modelId: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const reply = [
    `## رد تجريبي من ${modelId}\n\n`,
    `هذا رد **محاكى محليًا** لأن الـ Backend غير متصل بعد. في الإنتاج يأتي الرد عبر SSE من \`/api/v1/chats/:id/messages/stream\` دون أي مفاتيح في الواجهة.\n\n`,
    `طلبك: «${prompt.slice(0, 120)}»\n\n`,
    "### ما يدعمه هذا النموذج\n- بث تدريجي مع زر إيقاف\n- Markdown آمن (marked + DOMPurify)\n- إعادة توليد وتعديل وتقييم\n\n",
    "```python\n# مثال كود\ndef hello(name):\n    return f\"مرحبًا {name}\"\n```\n\n",
    "جرّب: أرفق صورة، ابحث داخل المحادثة، بدّل الثيم، أو صدّر المحادثة.",
  ].join("");
  const words = reply.split(/(?<=\s)/);
  for (let i = 0; i < words.length; i++) {
    if (signal.aborted) { yield { type: "done" }; return; }
    await new Promise((r) => setTimeout(r, 18));
    yield { type: "chunk", text: words[i] };
  }
  yield { type: "done" };
}
export function processingLabel(ms: number): string {
  return `اكتملت المعالجة خلال ${(ms / 1000).toFixed(1)} ثانية`;
}
