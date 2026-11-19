// File: zai/apps/api/src/common/env.ts — typed, validated environment loading
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be >= 32 chars"),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be >= 32 chars"),
  ALLOWED_ORIGINS: z.string().min(1, "ALLOWED_ORIGINS is required (comma-separated)"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MODEL_PROVIDER_BASE_URL: z.string().url().optional(),
  MODEL_PROVIDER_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  return parsed.data;
}
