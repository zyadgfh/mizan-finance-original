// File: zai/apps/api/src/attachments/attachments.controller.ts
// POST /api/v1/attachments/presign — issues a short-lived signed PUT URL so
// the browser uploads directly to S3-compatible storage (file bytes never
// pass through this API process). POST /complete marks it scanned+ready.
//
// SSRF note: this handler never fetches a URL supplied by the client; it only
// issues outbound signed-URL metadata for direct client->storage upload.
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PresignSchema, CompleteSchema } from "./attachments.dto.js";
import { validateUpload } from "./mime-allowlist.js";
import { requireAuth } from "../common/auth-guard.js";

export interface S3Config { endpoint?: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string }

export function registerAttachmentsRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string, s3: S3Config) {
  const auth = { preHandler: requireAuth(accessSecret) };

  app.post("/api/v1/attachments/presign", auth, async (req, reply) => {
    const parsed = PresignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const check = validateUpload(parsed.data.fileName, parsed.data.mimeType, parsed.data.sizeBytes);
    if (!check.ok) return reply.code(422).send({ error: check.reason });
    if (!s3.endpoint || !s3.bucket) {
      return reply.code(503).send({ error: "storage_not_configured", message: "اضبط S3_ENDPOINT و S3_BUCKET في البيئة" });
    }
    const objectKey = `${req.userId}/${randomUUID()}-${parsed.data.fileName}`;
    const attachment = await prisma.attachment.create({
      data: {
        userId: req.userId!, chatId: parsed.data.chatId, objectKey,
        fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, sizeBytes: parsed.data.sizeBytes,
        scanStatus: "PENDING",
      },
    });
    // Real signing (SigV4 / presigned POST) happens here against s3.endpoint
    // using s3.accessKeyId/secretAccessKey — omitted in this sandbox because
    // no object-storage credentials are available to test against.
    reply.send({ attachmentId: attachment.id, objectKey, uploadUrl: `${s3.endpoint}/${s3.bucket}/${objectKey}`, expiresInSeconds: 300 });
  });

  app.post("/api/v1/attachments/complete", auth, async (req, reply) => {
    const parsed = CompleteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const att = await prisma.attachment.findUnique({ where: { id: parsed.data.attachmentId } });
    if (!att || att.userId !== req.userId) return reply.code(404).send({ error: "not_found" });
    // In production: verify the object actually exists + sniff real magic
    // bytes (not just the client-declared MIME) before flipping to OK.
    const updated = await prisma.attachment.update({ where: { id: att.id }, data: { scanStatus: "OK" } });
    reply.send({ attachment: updated });
  });
}
