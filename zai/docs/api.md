# Z-Ai — API Reference (`zai/apps/api`)

Base path: `/api/v1`. All endpoints except `/auth/*` and `/health` require
`Authorization: Bearer <accessToken>`. The refresh token travels only as the
`zai_rt` HttpOnly/Secure/SameSite=strict cookie, scoped to `/api/v1/auth`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | Creates a user (Argon2id hash), issues a session |
| POST | `/auth/login` | — | Validates credentials, issues a session |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token (reuse-detected) |
| POST | `/auth/logout` | refresh cookie | Revokes the current refresh token |
| POST | `/auth/logout-all` | Bearer | Revokes every refresh token for the user |
| GET | `/me` | Bearer | Current user profile |
| GET | `/models` | Bearer | Server-authoritative model allowlist |
| GET | `/chats` | Bearer | `?trashed=1` to list the trash instead |
| POST | `/chats` | Bearer | `{ title?, modelId }` — modelId must be in the allowlist |
| PATCH | `/chats/:id` | Bearer + ownership | title/modelId/pinned/archived/groupName |
| DELETE | `/chats/:id` | Bearer + ownership | Soft delete (`trashedAt`) |
| POST | `/chats/:id/restore` | Bearer + ownership | Clears `trashedAt` |
| GET | `/chats/:id/messages` | Bearer + ownership | Ordered ascending |
| POST | `/chats/:id/messages/stream` | Bearer + ownership | **SSE**. Body: `{ content, modelId, attachmentIds? }`. Events: `chunk` (`{content}`), `done` (`{messageId, processingMs}`). Rate-limited at 20/min on top of the global limiter |
| PATCH | `/messages/:id` | Bearer + ownership (via chat) | content/pinned/rating |
| DELETE | `/messages/:id` | Bearer + ownership (via chat) | Hard delete |
| POST | `/attachments/presign` | Bearer | Validates MIME/ext/size, returns a short-lived upload target |
| POST | `/attachments/complete` | Bearer + ownership | Marks scan status `OK` |
| GET | `/usage` | Bearer | Per-model usage counts for the current user |
| GET | `/health` | — | `{status, db}` — used for readiness/liveness probes |

## Error shape

```json
{ "error": "invalid_input" | "unauthorized" | "forbidden" | "not_found" | "model_not_allowed" | "rate_limited" | "internal_error", "message": "...", "issues": [ /* zod issues, optional */ ] }
```

404 (not 403) is returned for any resource that exists but is not owned by
the caller, to avoid confirming the resource's existence to someone probing
IDs (`chats.controller.ts::requireOwnership`).

## SSE example

```
POST /api/v1/chats/c1/messages/stream
Authorization: Bearer eyJ...
Content-Type: application/json

{"content":"اشرح لي REST","modelId":"gpt-5-nano"}
```

```
event: chunk
data: {"content":"REST "}

event: chunk
data: {"content":"هو "}

event: done
data: {"messageId":"m2","processingMs":842,"userMessageId":"m1"}
```
