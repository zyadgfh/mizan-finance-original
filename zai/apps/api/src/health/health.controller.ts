// File: zai/apps/api/src/health/health.controller.ts — GET /api/v1/health
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

export function registerHealthRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/api/v1/health", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      reply.send({ status: "ok", db: "up", time: new Date().toISOString() });
    } catch {
      reply.code(503).send({ status: "degraded", db: "down", time: new Date().toISOString() });
    }
  });
}
