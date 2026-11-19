// File: zai/apps/api/src/messages/messages.dto.ts
import { z } from "zod";
export const SendMessageSchema = z.object({
  content: z.string().min(1).max(20_000),
  modelId: z.string().min(1).max(120),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
});
export const PatchMessageSchema = z.object({
  content: z.string().min(1).max(20_000).optional(),
  pinned: z.boolean().optional(),
  rating: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
});
