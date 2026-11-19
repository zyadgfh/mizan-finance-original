import assert from "node:assert/strict";
import test from "node:test";
import { validateBackup } from "./backup.ts";

function makeChat(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1", title: "محادثة", modelId: "gpt-5-nano",
    createdAt: Date.now(), updatedAt: Date.now(), messages: [],
    ...overrides,
  };
}

test("validateBackup accepts a well-formed Z-Ai backup", () => {
  const r = validateBackup({ app: "z-ai", version: 1, exportedAt: Date.now(), chats: [makeChat()] });
  assert.equal(r.ok, true);
});

test("validateBackup rejects a backup from a different app", () => {
  const r = validateBackup({ app: "other-app", version: 1, exportedAt: Date.now(), chats: [] });
  assert.equal(r.ok, false);
});

test("validateBackup rejects malformed message roles", () => {
  const chat = makeChat({
    messages: [{ id: "m1", chatId: "c1", role: "hacker", content: "x", status: "done", createdAt: 1, updatedAt: 1 }],
  });
  const r = validateBackup({ app: "z-ai", version: 1, exportedAt: Date.now(), chats: [chat] });
  assert.equal(r.ok, false);
});

test("validateBackup rejects oversized/garbage top-level input", () => {
  const r = validateBackup("not even an object");
  assert.equal(r.ok, false);
  const r2 = validateBackup(null);
  assert.equal(r2.ok, false);
});

test("validateBackup enforces attachment size ceilings", () => {
  const chat = makeChat({
    messages: [{
      id: "m1", chatId: "c1", role: "user", content: "x", status: "done", createdAt: 1, updatedAt: 1,
      attachments: [{ id: "a1", name: "x.png", kind: "image", mime: "image/png", size: 999_999_999 }],
    }],
  });
  const r = validateBackup({ app: "z-ai", version: 1, exportedAt: Date.now(), chats: [chat] });
  assert.equal(r.ok, false);
});
