// File: zai/apps/api/src/usage/usage.controller.ts — GET /api/v1/usage
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { requireAuth } from "../common/auth-guard.js";

export function registerUsageRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string) {
  app.get("/api/v1/usage", { preHandler: requireAuth(accessSecret) }, async (req, reply) => {
    const events = await prisma.usageEvent.groupBy({
      by: ["modelId"], where: { userId: req.userId! }, _count: { _all: true },
    });
    reply.send({ usage: events.map((e: { modelId: string; _count: { _all: number } }) => ({ modelId: e.modelId, count: e._count._all })) });
  });
}
