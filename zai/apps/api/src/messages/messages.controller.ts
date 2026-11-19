// File: zai/apps/api/src/messages/messages.controller.ts
// POST /api/v1/chats/:id/messages/stream — Server-Sent Events.
//
// Reasoning policy (hard requirement): if the upstream model provider returns
// a `reasoning`/`reasoning_content`/`thinking` field, this handler MUST NOT
// forward it to the client or persist it. Only a bounded, safe status summary
// (processingMs) is ever stored — see redactReasoning() below.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { SendMessageSchema, PatchMessageSchema } from "./messages.dto.js";
import { isAllowedModel } from "../models/models.catalog.js";
import { requireAuth } from "../common/auth-guard.js";
import { requireOwnership } from "../chats/chats.controller.js";
import { MESSAGE_SEND_LIMIT } from "../common/rate-limit.js";

const MAX_HISTORY_MESSAGES = 40;
const MAX_SYSTEM_PROMPT_CHARS = 2000;

/** Strips any reasoning/chain-of-thought fields a provider might return.
 * Never pass raw provider payloads straight through to the client/DB. */
function redactReasoning<T extends Record<string, unknown>>(providerMessage: T): { content: string } {
  const content = typeof providerMessage.content === "string" ? providerMessage.content : "";
  return { content }; // reasoning / reasoning_content / thinking fields are intentionally dropped
}

function sseSend(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerMessagesRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string) {
  const auth = { preHandler: requireAuth(accessSecret) };

  app.post("/api/v1/chats/:id/messages/stream", { ...auth, config: { rateLimit: MESSAGE_SEND_LIMIT } }, async (req, reply) => {
    const { id: chatId } = req.params as { id: string };
    const chat = await requireOwnership(prisma, chatId, req.userId!, reply);
    if (!chat) return;

    const parsed = SendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
    if (!isAllowedModel(parsed.data.modelId)) return reply.code(400).send({ error: "model_not_allowed" });

    const userMsg = await prisma.message.create({
      data: { chatId, role: "USER", content: parsed.data.content, modelId: parsed.data.modelId, status: "DONE" },
    });

    // Bound how much history + which system prompt reach the provider.
    const history = await prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "desc" }, take: MAX_HISTORY_MESSAGES });
    void history; // wired into the real provider call in production; omitted here (no provider keys in this sandbox)
    const systemPrompt = ((req.body as { systemPrompt?: string }).systemPrompt ?? "").slice(0, MAX_SYSTEM_PROMPT_CHARS);
    void systemPrompt;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const assistantMsg = await prisma.message.create({
      data: { chatId, role: "ASSISTANT", content: "", modelId: parsed.data.modelId, status: "STREAMING" },
    });

    const start = Date.now();
    let aborted = false;
    req.raw.on("close", () => { aborted = true; });

    // Placeholder generation loop — production wires this to the real
    // provider's streaming completion endpoint using server-held API keys
    // (never exposed to the client) and pipes redactReasoning() over each chunk.
    const demoText = "تم استلام رسالتك. في الإنتاج يتصل هذا المسار بمزود النموذج عبر مفاتيح محفوظة في الخادم فقط.";
    for (const word of demoText.split(/(?<=\s)/)) {
      if (aborted) break;
      await new Promise((r) => setTimeout(r, 15));
      const safe = redactReasoning({ content: word });
      sseSend(reply, "chunk", safe);
    }

    const processingMs = Date.now() - start;
    const finalContent = aborted ? "" : demoText;
    await prisma.message.update({
      where: { id: assistantMsg.id },
      data: { content: finalContent, status: aborted ? "STOPPED" : "DONE", processingMs },
    });
    if (!aborted) {
      sseSend(reply, "done", { messageId: assistantMsg.id, processingMs, userMessageId: userMsg.id });
    }
    reply.raw.end();
  });

  app.patch("/api/v1/messages/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const message = await prisma.message.findUnique({ where: { id }, include: { chat: true } });
    if (!message || message.chat.userId !== req.userId) return reply.code(404).send({ error: "not_found" });
    const parsed = PatchMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.content) data.editedAt = new Date();
    const updated = await prisma.message.update({ where: { id }, data });
    reply.send({ message: updated });
  });

  app.delete("/api/v1/messages/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const message = await prisma.message.findUnique({ where: { id }, include: { chat: true } });
    if (!message || message.chat.userId !== req.userId) return reply.code(404).send({ error: "not_found" });
    await prisma.message.delete({ where: { id } });
    reply.send({ ok: true });
  });
}
