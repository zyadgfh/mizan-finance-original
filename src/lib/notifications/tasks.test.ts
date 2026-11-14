import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addScheduledTask,
  loadScheduledTasks,
  nextOccurrence,
  removeScheduledTask,
  setScheduledTaskEnabled,
  taskNotificationId,
  type ScheduledTask,
} from "./tasks.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe("scheduled tasks", () => {
  it("persists a normalized task and loads it sorted by due date", () => {
    const store = storage();
    const task = addScheduledTask({ title: "  سداد الإيجار ", body: "  تذكير  ", dueAt: future, repeat: "monthly" }, store);
    const loaded = loadScheduledTasks(store);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.title, "سداد الإيجار");
    assert.equal(loaded[0]?.body, "تذكير");
    assert.equal(loaded[0]?.enabled, true);
    assert.equal(task.repeat, "monthly");
  });

  it("calculates daily, weekly and monthly occurrences after the last due time", () => {
    const from = new Date("2026-01-10T10:00:00.000Z");
    const make = (repeat: ScheduledTask["repeat"]): ScheduledTask => ({ id: repeat, title: repeat, body: "", dueAt: "2026-01-01T10:00:00.000Z", repeat, enabled: true, createdAt: 1, updatedAt: 1 });
    assert.equal(nextOccurrence(make("daily"), from)?.toISOString(), "2026-01-11T10:00:00.000Z");
    assert.equal(nextOccurrence(make("weekly"), from)?.toISOString(), "2026-01-15T10:00:00.000Z");
    assert.equal(nextOccurrence(make("monthly"), from)?.toISOString(), "2026-02-01T10:00:00.000Z");
  });

  it("disables and removes tasks without affecting other records", () => {
    const store = storage();
    const first = addScheduledTask({ title: "الأولى", body: "", dueAt: future, repeat: "once" }, store);
    const second = addScheduledTask({ title: "الثانية", body: "", dueAt: future, repeat: "daily" }, store);
    setScheduledTaskEnabled(first.id, false, store);
    assert.equal(loadScheduledTasks(store).find((task) => task.id === first.id)?.enabled, false);
    removeScheduledTask(first.id, store);
    assert.deepEqual(loadScheduledTasks(store).map((task) => task.id), [second.id]);
  });

  it("creates a stable positive Android notification id", () => {
    assert.equal(taskNotificationId("abc"), taskNotificationId("abc"));
    assert.ok(taskNotificationId("abc") > 0);
  });

  it("rejects empty titles and past one-time tasks", () => {
    const store = storage();
    assert.throws(() => addScheduledTask({ title: " ", body: "", dueAt: future, repeat: "once" } as never, store));
    assert.throws(() => addScheduledTask({ title: "مهمة", body: "", dueAt: "2020-01-01T00:00", repeat: "once" }, store));
  });
});
