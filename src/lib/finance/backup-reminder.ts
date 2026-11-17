import { useSyncExternalStore } from "react";

export const BACKUP_TIMESTAMP_KEY = "mizan.backup.lastExportAt.v1";
export const BACKUP_REMINDER_AFTER_DAYS = 14;
const DAY_MS = 86_400_000;
const listeners = new Set<() => void>();

function browserStorage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function readLastBackupAt(storage: Storage | undefined = browserStorage()): number | null {
  try {
    const raw = storage?.getItem(BACKUP_TIMESTAMP_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function recordBackupExport(now = Date.now(), storage: Storage | undefined = browserStorage()): number {
  try {
    storage?.setItem(BACKUP_TIMESTAMP_KEY, String(now));
  } catch {
    // The reminder is best-effort; never block a backup because storage is full.
  }
  for (const listener of listeners) listener();
  return now;
}

export type BackupReminderStatus = {
  lastBackupAt: number | null;
  ageDays: number | null;
  due: boolean;
};

export function backupReminderStatus(now = Date.now(), lastBackupAt = readLastBackupAt()): BackupReminderStatus {
  const ageDays = lastBackupAt === null ? null : Math.max(0, Math.floor((now - lastBackupAt) / DAY_MS));
  return {
    lastBackupAt,
    ageDays,
    due: ageDays === null || ageDays >= BACKUP_REMINDER_AFTER_DAYS,
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

const getSnapshot = () => readLastBackupAt();
const getServerSnapshot = () => null;

export function useBackupReminderStatus(now = Date.now()): BackupReminderStatus {
  const lastBackupAt = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return backupReminderStatus(now, lastBackupAt);
}
