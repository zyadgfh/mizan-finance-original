// File: zai/apps/api/src/common/auth-guard.ts
// Fastify hook: resolves the caller's userId from the Authorization bearer
// access token. Routes must use this instead of trusting any client-supplied
// userId in the request body — see docs/security.md "Ownership checks".
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: "USER" | "ADMIN";
  }
}

export function requireAuth(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing access token" });
    }
    try {
      const payload = verifyAccessToken(header.slice(7), secret);
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      return reply.code(401).send({ error: "unauthorized", message: "Invalid or expired access token" });
    }
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (req.userRole !== "ADMIN") {
    reply.code(403).send({ error: "forbidden", message: "Admin role required" });
    return;
  }
  done();
}
