// File: zai/apps/api/src/auth/auth.controller.ts
// POST /api/v1/auth/{register,login,refresh,logout}, GET /api/v1/me
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AuthService } from "./auth.service.js";
import { RegisterSchema, LoginSchema } from "./auth.dto.js";
import { REFRESH_COOKIE_NAME } from "../common/jwt.js";
import { requireAuth } from "../common/auth-guard.js";

function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/v1/auth",
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient, accessSecret: string, cookieSecure: boolean) {
  const service = new AuthService(prisma, accessSecret);

  app.post("/api/v1/auth/register", async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
    try {
      const user = await service.register(parsed.data.email, parsed.data.password, parsed.data.displayName);
      const session = await service.issueSession(user.id, user.role, { ip: req.ip, userAgent: req.headers["user-agent"] });
      setRefreshCookie(reply, session.refreshToken, session.expiresAt, cookieSecure);
      await prisma.auditEvent.create({ data: { userId: user.id, action: "auth.register", ip: req.ip } });
      return reply.code(201).send({ accessToken: session.accessToken, user: { id: user.id, email: user.email } });
    } catch (e) {
      if ((e as Error).message === "EMAIL_IN_USE") return reply.code(409).send({ error: "email_in_use" });
      req.log.error(e, "register failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const user = await service.validateCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      await prisma.auditEvent.create({ data: { action: "auth.login.failed", ip: req.ip, metadata: { email: parsed.data.email } } });
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const session = await service.issueSession(user.id, user.role, { ip: req.ip, userAgent: req.headers["user-agent"] });
    setRefreshCookie(reply, session.refreshToken, session.expiresAt, cookieSecure);
    await prisma.auditEvent.create({ data: { userId: user.id, action: "auth.login", ip: req.ip } });
    return reply.send({ accessToken: session.accessToken, user: { id: user.id, email: user.email } });
  });

  app.post("/api/v1/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE_NAME];
    if (!token) return reply.code(401).send({ error: "no_refresh_token" });
    try {
      const session = await service.rotateRefreshToken(token, { ip: req.ip, userAgent: req.headers["user-agent"] });
      setRefreshCookie(reply, session.refreshToken, session.expiresAt, cookieSecure);
      return reply.send({ accessToken: session.accessToken });
    } catch (e) {
      if ((e as Error).message === "REFRESH_REUSE_DETECTED") {
        await prisma.auditEvent.create({ data: { action: "auth.refresh.reuse_detected", ip: req.ip } });
      }
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE_NAME];
    if (token) await service.revokeToken(token);
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
    return reply.send({ ok: true });
  });

  app.post("/api/v1/auth/logout-all", { preHandler: requireAuth(accessSecret) }, async (req, reply) => {
    await service.revokeAllForUser(req.userId!);
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
    await prisma.auditEvent.create({ data: { userId: req.userId, action: "auth.logout_all", ip: req.ip } });
    return reply.send({ ok: true });
  });

  app.get("/api/v1/me", { preHandler: requireAuth(accessSecret) }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, email: true, displayName: true, role: true, createdAt: true } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    return reply.send(user);
  });

  // Expose for reuse by chats/messages/attachments controllers.
  return { service };
}
