// File: zai/apps/api/src/auth/auth.dto.ts
import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10).max(128),
  displayName: z.string().min(1).max(80).optional(),
});
export const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
