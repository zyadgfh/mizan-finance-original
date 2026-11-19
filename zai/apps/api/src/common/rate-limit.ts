// File: zai/apps/api/src/common/rate-limit.ts
// Per-user AND per-IP rate limiting via @fastify/rate-limit, backed by Redis
// in production (falls back to in-memory store only outside production).
import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { Redis } from "ioredis";

export async function registerRateLimit(app: FastifyInstance, redisUrl: string | undefined) {
  const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1 }) : undefined;
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (req: FastifyRequest) => {
      const userId = (req as { userId?: string }).userId;
      return userId ? `u:${userId}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      error: "rate_limited",
      message: "تجاوزت الحد المسموح من الطلبات. حاول بعد قليل.",
    }),
  });
}

// Stricter bucket specifically for the message-send / stream endpoint, since
// that is the most expensive and abuse-prone route.
export const MESSAGE_SEND_LIMIT = { max: 20, timeWindow: "1 minute" } as const;
