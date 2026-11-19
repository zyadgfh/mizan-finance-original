// File: zai/apps/api/src/attachments/attachments.dto.ts
import { z } from "zod";
export const PresignSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  chatId: z.string().uuid().optional(),
});
export const CompleteSchema = z.object({
  attachmentId: z.string().uuid(),
});
