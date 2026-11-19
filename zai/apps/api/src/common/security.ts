// File: zai/apps/api/src/common/security.ts
// Central security wiring: Helmet headers, CORS allowlist (NEVER '*' with
// credentials), and the CSP used by the API's own JSON/SSE responses.
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";

export function parseAllowedOrigins(env: string | undefined): string[] {
  return (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function registerSecurity(app: FastifyInstance, allowedOrigins: string[]) {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header (curl, same-origin, server-to-server) — allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Origin not allowed by CORS policy"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
}
