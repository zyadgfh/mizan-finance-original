// File: zai/apps/api/src/models/models.controller.ts — GET /api/v1/models
import type { FastifyInstance } from "fastify";
import { MODEL_CATALOG } from "./models.catalog.js";
import { requireAuth } from "../common/auth-guard.js";

export function registerModelsRoutes(app: FastifyInstance, accessSecret: string) {
  app.get("/api/v1/models", { preHandler: requireAuth(accessSecret) }, async (_req, reply) => {
    reply.send({ models: MODEL_CATALOG.filter((m) => m.enabled) });
  });
}
