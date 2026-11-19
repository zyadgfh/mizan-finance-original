// File: zai/apps/api/src/main.ts — Z-Ai API entrypoint (Fastify)
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./common/env.js";
import { registerSecurity, parseAllowedOrigins } from "./common/security.js";
import { registerRateLimit } from "./common/rate-limit.js";
import { registerAuthRoutes } from "./auth/auth.controller.js";
import { registerChatsRoutes } from "./chats/chats.controller.js";
import { registerMessagesRoutes } from "./messages/messages.controller.js";
import { registerModelsRoutes } from "./models/models.controller.js";
import { registerAttachmentsRoutes } from "./attachments/attachments.controller.js";
import { registerUsageRoutes } from "./usage/usage.controller.js";
import { registerHealthRoutes } from "./health/health.controller.js";

async function main() {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      // Never log request bodies (may contain message content / credentials).
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
  });

  const prisma = new PrismaClient();
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  await registerSecurity(app, allowedOrigins);
  await registerRateLimit(app, env.REDIS_URL);
  await app.register(cookie, { secret: env.COOKIE_SECRET });

  const cookieSecure = env.NODE_ENV === "production";
  registerAuthRoutes(app, prisma, env.JWT_ACCESS_SECRET, cookieSecure);
  registerChatsRoutes(app, prisma, env.JWT_ACCESS_SECRET);
  registerMessagesRoutes(app, prisma, env.JWT_ACCESS_SECRET);
  registerModelsRoutes(app, env.JWT_ACCESS_SECRET);
  registerAttachmentsRoutes(app, prisma, env.JWT_ACCESS_SECRET, {
    endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
  registerUsageRoutes(app, prisma, env.JWT_ACCESS_SECRET);
  registerHealthRoutes(app, prisma);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down gracefully`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
