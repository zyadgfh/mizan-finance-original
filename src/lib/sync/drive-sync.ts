import type { Data } from "../finance/types.ts";

export const SYNC_VERSION = 1 as const;

export type DriveSyncRecord = {
  version: typeof SYNC_VERSION;
  updatedAt: number;
  deviceId: string;
  data: Data;
  revision?: string;
};

export type DriveSyncAdapter = {
  read: () => Promise<DriveSyncRecord | null>;
  write: (record: DriveSyncRecord, expectedRevision?: string) => Promise<{ revision?: string }>;
};

export type SyncPhase = "idle" | "syncing" | "synced" | "error";
export type SyncErrorCode = "network" | "unauthorized" | "invalid-remote" | "conflict" | "unknown";

export type SyncState = {
  phase: SyncPhase;
  errorCode?: SyncErrorCode;
  message?: string;
  lastSyncedAt?: number;
};

export type SyncResult = {
  data: Data;
  source: "local" | "remote" | "uploaded" | "local-fallback";
  state: SyncState;
};

export type DriveSyncController = {
  sync: (local: Data, localUpdatedAt: number) => Promise<SyncResult>;
  getState: () => SyncState;
  subscribe: (listener: (state: SyncState) => void) => () => void;
};

function isData(value: unknown): value is Data {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Data>;
  return (
    Array.isArray(candidate.txns) &&
    Array.isArray(candidate.people) &&
    Array.isArray(candidate.debts) &&
    Array.isArray(candidate.payments) &&
    Array.isArray(candidate.categories) &&
    Array.isArray(candidate.budgets) &&
    Array.isArray(candidate.wallets) &&
    Array.isArray(candidate.transfers) &&
    Array.isArray(candidate.recurring) &&
    Array.isArray(candidate.goals) &&
    Array.isArray(candidate.goalMoves) &&
    typeof candidate.openingBalance === "number" &&
    typeof candidate.currency === "string" &&
    typeof candidate.demo === "boolean"
  );
}

export function isDriveSyncRecord(value: unknown): value is DriveSyncRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DriveSyncRecord>;
  return record.version === SYNC_VERSION && typeof record.updatedAt === "number" && isData(record.data);
}

function classifyError(error: unknown): { code: SyncErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown sync error");
  if (/401|403|unauthori[sz]ed|forbidden|login/i.test(message)) return { code: "unauthorized", message };
  if (/revision|conflict|412|409/i.test(message)) return { code: "conflict", message };
  if (/invalid|schema|version|payload/i.test(message)) return { code: "invalid-remote", message };
  if (/network|offline|fetch|timeout|connection/i.test(message)) return { code: "network", message };
  return { code: "unknown", message };
}

export function createDriveSyncController(adapter: DriveSyncAdapter): DriveSyncController {
  let state: SyncState = { phase: "idle" };
  let inFlight: Promise<SyncResult> | null = null;
  const listeners = new Set<(next: SyncState) => void>();

  function setState(next: SyncState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function fallback(local: Data, error: unknown): SyncResult {
    const classified = classifyError(error);
    const nextState: SyncState = { phase: "error", errorCode: classified.code, message: classified.message };
    setState(nextState);
    return { data: local, source: "local-fallback", state: nextState };
  }

  async function run(local: Data, localUpdatedAt: number): Promise<SyncResult> {
    setState({ phase: "syncing" });
    try {
      const remote = await adapter.read();
      if (remote !== null && !isDriveSyncRecord(remote)) {
        throw new Error("Invalid remote sync payload");
      }

      if (!remote) {
        await adapter.write({
          version: SYNC_VERSION,
          updatedAt: localUpdatedAt,
          deviceId: "current-device",
          data: local,
        });
        const nextState: SyncState = { phase: "synced", lastSyncedAt: Date.now() };
        setState(nextState);
        return { data: local, source: "uploaded", state: nextState };
      }

      if (remote.updatedAt > localUpdatedAt) {
        const nextState: SyncState = { phase: "synced", lastSyncedAt: Date.now() };
        setState(nextState);
        return { data: remote.data, source: "remote", state: nextState };
      }

      if (localUpdatedAt > remote.updatedAt) {
        await adapter.write(
          {
            ...remote,
            version: SYNC_VERSION,
            updatedAt: localUpdatedAt,
            deviceId: "current-device",
            data: local,
          },
          remote.revision,
        );
        const nextState: SyncState = { phase: "synced", lastSyncedAt: Date.now() };
        setState(nextState);
        return { data: local, source: "uploaded", state: nextState };
      }

      const nextState: SyncState = { phase: "synced", lastSyncedAt: Date.now() };
      setState(nextState);
      return { data: local, source: "local", state: nextState };
    } catch (error) {
      return fallback(local, error);
    }
  }

  return {
    sync(local, localUpdatedAt) {
      if (!inFlight) {
        inFlight = run(local, localUpdatedAt).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
