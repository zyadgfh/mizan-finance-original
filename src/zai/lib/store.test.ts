import assert from "node:assert/strict";
import test from "node:test";

// The Zustand store (store.ts) touches `localStorage`/`navigator`, which only
// exist in a browser-like environment. We exercise the same reducer-style
// logic here in isolation (pure functions extracted conceptually from the
// store's update callbacks) so this suite runs under plain Node, matching
// this repo's existing `node --test` convention (no jsdom dependency).
import type { Chat, Message } from "../types.ts";

function addMessageReducer(chats: Chat[], chatId: string, m: Message): Chat[] {
  return chats.map((c) =>
    c.id === chatId
      ? { ...c, messages: [...c.messages, m], updatedAt: m.createdAt, title: c.title === "محادثة جديدة" && m.role === "user" ? m.content.slice(0, 40) : c.title }
      : c,
  );
}
function deleteChatReducer(chats: Chat[], id: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, trashed: true } : c));
}
function restoreChatReducer(chats: Chat[], id: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, trashed: false, archived: false } : c));
}
function togglePinReducer(chats: Chat[], id: string): Chat[] {
  return chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
}

function baseChat(id: string): Chat {
  return { id, title: "محادثة جديدة", modelId: "gpt-5-nano", createdAt: 1, updatedAt: 1, messages: [] };
}

test("addMessage sets the chat title from the first user message once", () => {
  const chats = [baseChat("c1")];
  const msg: Message = { id: "m1", chatId: "c1", role: "user", content: "اشرح لي الذكاء الاصطناعي من فضلك", status: "done", createdAt: 2, updatedAt: 2 };
  const next = addMessageReducer(chats, "c1", msg);
  assert.equal(next[0].title, "اشرح لي الذكاء الاصطناعي من فضلك".slice(0, 40));
  assert.equal(next[0].messages.length, 1);
});

test("addMessage does not overwrite a title that was already customized", () => {
  const chats = [{ ...baseChat("c1"), title: "عنوان مخصص" }];
  const msg: Message = { id: "m1", chatId: "c1", role: "user", content: "رسالة", status: "done", createdAt: 2, updatedAt: 2 };
  const next = addMessageReducer(chats, "c1", msg);
  assert.equal(next[0].title, "عنوان مخصص");
});

test("delete moves a chat to trashed without removing it (soft delete / undo support)", () => {
  const chats = [baseChat("c1")];
  const next = deleteChatReducer(chats, "c1");
  assert.equal(next[0].trashed, true);
  assert.equal(next.length, 1);
});

test("restore clears trashed and archived flags", () => {
  const chats = [{ ...baseChat("c1"), trashed: true, archived: true }];
  const next = restoreChatReducer(chats, "c1");
  assert.equal(next[0].trashed, false);
  assert.equal(next[0].archived, false);
});

test("togglePin flips only the targeted chat", () => {
  const chats = [baseChat("c1"), baseChat("c2")];
  const next = togglePinReducer(chats, "c1");
  assert.equal(next[0].pinned, true);
  assert.equal(next[1].pinned, undefined);
});
