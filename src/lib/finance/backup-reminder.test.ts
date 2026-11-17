import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKUP_REMINDER_AFTER_DAYS,
  BACKUP_TIMESTAMP_KEY,
  backupReminderStatus,
  readLastBackupAt,
  recordBackupExport,
} from "./backup-reminder.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("backup reminder", () => {
  it("reminds when there is no export yet and clears the reminder after export", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 10, 16);
    assert.deepEqual(backupReminderStatus(now, readLastBackupAt(storage)), {
      lastBackupAt: null,
      ageDays: null,
      due: true,
    });
    assert.equal(recordBackupExport(now, storage), now);
    assert.equal(storage.getItem(BACKUP_TIMESTAMP_KEY), String(now));
    assert.deepEqual(backupReminderStatus(now + 3 * 86_400_000, readLastBackupAt(storage)), {
      lastBackupAt: now,
      ageDays: 3,
      due: false,
    });
  });

  it("becomes due at the configured reminder interval and handles future clock skew", () => {
    const now = Date.UTC(2026, 10, 16);
    assert.equal(backupReminderStatus(now, now - BACKUP_REMINDER_AFTER_DAYS * 86_400_000).due, true);
    assert.deepEqual(backupReminderStatus(now, now + 86_400_000), {
      lastBackupAt: now + 86_400_000,
      ageDays: 0,
      due: false,
    });
  });

  it("ignores malformed storage and remains usable when storage is unavailable", () => {
    const storage = new MemoryStorage();
    storage.setItem(BACKUP_TIMESTAMP_KEY, "not-a-date");
    assert.equal(readLastBackupAt(storage), null);
    assert.equal(recordBackupExport(123, undefined), 123);
  });
});
