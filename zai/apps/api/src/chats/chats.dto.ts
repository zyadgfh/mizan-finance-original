// File: zai/apps/api/src/chats/chats.dto.ts
import { z } from "zod";
export const CreateChatSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  modelId: z.string().min(1).max(120),
});
export const PatchChatSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  modelId: z.string().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  groupName: z.string().max(80).nullable().optional(),
});
