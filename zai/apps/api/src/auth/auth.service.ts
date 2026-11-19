// File: zai/apps/api/src/auth/auth.service.ts
// Argon2id password hashing, rotating refresh tokens with reuse detection,
// and revoke-all-sessions support.
import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";
import { newOpaqueToken, sha256, signAccessToken, REFRESH_TOKEN_TTL_DAYS } from "../common/jwt.js";
import { randomUUID } from "node:crypto";

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export class AuthService {
  constructor(private prisma: PrismaClient, private accessSecret: string) {}

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new Error("EMAIL_IN_USE");
    const passwordHash = await argon2.hash(password, ARGON2_OPTS);
    return this.prisma.user.create({ data: { email, passwordHash, displayName } });
  }

  async validateCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    return ok ? user : null;
  }

  async issueSession(userId: string, role: "USER" | "ADMIN", meta: { ip?: string; userAgent?: string }) {
    const access = signAccessToken({ sub: userId, role }, this.accessSecret);
    const { raw, hash } = newOpaqueToken();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hash, familyId, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    return { accessToken: access, refreshToken: raw, expiresAt };
  }

  /** Rotates a refresh token. Reuse of an already-rotated/revoked token
   * revokes the entire token family (classic refresh-token-theft defense). */
  async rotateRefreshToken(rawToken: string, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!existing || existing.expiresAt < new Date()) throw new Error("INVALID_REFRESH");
    if (existing.revoked) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: existing.familyId }, data: { revoked: true } });
      throw new Error("REFRESH_REUSE_DETECTED");
    }
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revoked: true } });
    const { raw, hash: newHash } = newOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await this.prisma.refreshToken.create({
      data: { userId: existing.userId, tokenHash: newHash, familyId: existing.familyId, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    const access = signAccessToken({ sub: user.id, role: user.role }, this.accessSecret);
    return { accessToken: access, refreshToken: raw, expiresAt };
  }

  async revokeToken(rawToken: string) {
    const hash = sha256(rawToken);
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hash }, data: { revoked: true } });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
  }
}
