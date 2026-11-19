// File: zai/apps/api/src/common/jwt.ts
// Short-lived access tokens (JWT, 15min) + opaque rotating refresh tokens
// (stored only as a SHA-256 hash in RefreshToken.tokenHash — see schema).
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

export interface AccessTokenPayload { sub: string; role: "USER" | "ADMIN" }

export function signAccessToken(payload: AccessTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "15m" });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  return jwt.verify(token, secret) as AccessTokenPayload;
}

export function newOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export const REFRESH_COOKIE_NAME = "zai_rt";
export const REFRESH_TOKEN_TTL_DAYS = 30;
