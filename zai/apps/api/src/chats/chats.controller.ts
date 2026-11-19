// File: zai/apps/api/src/chats/chats.controller.ts
// CRUD + trash/restore for chats. Every handler loads the chat scoped to
// req.userId (never trusts a userId from the body) and calls
// requireOwnership() before any read/mutation — this is the IDOR defense
// that zai/skills/cfsa/scripts/cfsa.mjs greps for.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { CreateChatSchema, PatchChatSchema } from "./chats.dto.js";
import { isAllowedModel } from "../models/models.catalog.js";
import { requireAuth } from "../common/auth-guard.js";

async function requireOwnership(prisma: PrismaClient, chatId: string, userId: string, reply: FastifyReply) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || chat.userId !== userId) {
    reply.code(404).send({ error: "not_found" }); // 404, not 403 — avoid leaking existence
    return null;
  }
  return chat;
}

export function registerChatsRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string) {
  const auth = { preHandler: requireAuth(accessSecret) };

  app.get("/api/v1/chats", auth, async (req, reply) => {
    const includeTrashed = (req.query as { trashed?: string }).trashed === "1";
    const chats = await prisma.chat.findMany({
      where: { userId: req.userId!, trashedAt: includeTrashed ? { not: null } : null },
      orderBy: { updatedAt: "desc" },
    });
    reply.send({ chats });
  });

  app.post("/api/v1/chats", auth, async (req, reply) => {
    const parsed = CreateChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
    if (!isAllowedModel(parsed.data.modelId)) return reply.code(400).send({ error: "model_not_allowed" });
    const chat = await prisma.chat.create({ data: { userId: req.userId!, title: parsed.data.title ?? "محادثة جديدة", modelId: parsed.data.modelId } });
    reply.code(201).send({ chat });
  });

  app.patch("/api/v1/chats/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = await requireOwnership(prisma, id, req.userId!, reply);
    if (!chat) return;
    const parsed = PatchChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    if (parsed.data.modelId && !isAllowedModel(parsed.data.modelId)) return reply.code(400).send({ error: "model_not_allowed" });
    const updated = await prisma.chat.update({ where: { id }, data: parsed.data });
    reply.send({ chat: updated });
  });

  app.delete("/api/v1/chats/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = await requireOwnership(prisma, id, req.userId!, reply);
    if (!chat) return;
    const updated = await prisma.chat.update({ where: { id }, data: { trashedAt: new Date() } });
    reply.send({ chat: updated });
  });

  app.post("/api/v1/chats/:id/restore", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = await requireOwnership(prisma, id, req.userId!, reply);
    if (!chat) return;
    const updated = await prisma.chat.update({ where: { id }, data: { trashedAt: null } });
    reply.send({ chat: updated });
  });

  app.get("/api/v1/chats/:id/messages", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = await requireOwnership(prisma, id, req.userId!, reply);
    if (!chat) return;
    const messages = await prisma.message.findMany({ where: { chatId: id }, orderBy: { createdAt: "asc" } });
    reply.send({ messages });
  });
}

export { requireOwnership };
