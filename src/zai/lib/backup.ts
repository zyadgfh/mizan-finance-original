// File: src/zai/lib/backup.ts — strict backup import validation (zod)
import { z } from "zod";
const AttachmentSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(255),
  kind: z.enum(["image","file"]), mime: z.string().max(120),
  size: z.number().int().min(0).max(50 * 1024 * 1024),
  dataUrl: z.string().max(12 * 1024 * 1024).optional(),
  scan: z.enum(["ok","blocked","pending"]).optional(),
});
const MessageSchema = z.object({
  id: z.string().min(1).max(64), chatId: z.string().max(64),
  role: z.enum(["user","assistant","system"]),
  content: z.string().max(200_000),
  modelId: z.string().max(120).optional(),
  status: z.enum(["pending","streaming","done","error","stopped"]),
  errorCode: z.string().max(80).nullable().optional(),
  createdAt: z.number().int().positive(), updatedAt: z.number().int().positive(),
  editedAt: z.number().int().nullable().optional(),
  pinned: z.boolean().optional(), rating: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  attachments: z.array(AttachmentSchema).max(10).optional(),
  processingMs: z.number().int().min(0).optional(),
});
const ChatSchema = z.object({
  id: z.string().min(1).max(64), title: z.string().max(300),
  modelId: z.string().max(120), group: z.string().max(80).optional(),
  pinned: z.boolean().optional(), archived: z.boolean().optional(), trashed: z.boolean().optional(),
  createdAt: z.number().int().positive(), updatedAt: z.number().int().positive(),
  messages: z.array(MessageSchema).max(5000),
});
export const BackupSchema = z.object({
  app: z.literal("z-ai"), version: z.number().int().min(1).max(10),
  exportedAt: z.number().int().positive(),
  chats: z.array(ChatSchema).max(1000),
});
export type Backup = z.infer<typeof BackupSchema>;
export function validateBackup(data: unknown): { ok: true; backup: Backup } | { ok: false; error: string } {
  const r = BackupSchema.safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "ملف غير صالح" };
  return { ok: true, backup: r.data };
}
