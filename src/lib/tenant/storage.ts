import type { Data } from "../finance/types.ts";
import { MIZAN_LOCAL_STORAGE_KEYS } from "../finance/security.ts";
import type { EntityType, OutboxOp, SubscriptionPlan, TenantSummary, TenantUser } from "./types.ts";

export const AUTH_SESSION_CACHE_KEY = "mizan.auth.sessionCache.v1";
export const ACTIVE_TENANT_STORAGE_KEY = "mizan.auth.activeTenant.v1";
export const LEGACY_MIGRATED_FLAG_KEY = "mizan.migratedToTenant.v1";

export function tenantDataKey(tenantId: string): string {
  return `mizan.tenant.${tenantId}.v1`;
}

export function tenantOutboxKey(tenantId: string): string {
  return `mizan.tenant.${tenantId}.outbox.v1`;
}

export function tenantCursorKey(tenantId: string): string {
  return `mizan.tenant.${tenantId}.cursor.v1`;
}

export function tenantUpdatedAtKey(tenantId: string): string {
  return `mizan.tenant.${tenantId}.updatedAt`;
}

export function localWorkspacesKey(userId: string): string {
  return `mizan.user.${userId}.localWorkspaces.v1`;
}

export type CachedSessionBundle = {
  user: TenantUser;
  workspaces: TenantSummary[];
  plans: SubscriptionPlan[];
  isSuperAdmin: boolean;
  cachedAt: number;
};

export function loadCachedSessionBundle(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): CachedSessionBundle | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTH_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSessionBundle>;
    if (!parsed?.user?.id || !Array.isArray(parsed.workspaces)) return null;
    return {
      user: parsed.user,
      workspaces: parsed.workspaces,
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      isSuperAdmin: Boolean(parsed.isSuperAdmin),
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveCachedSessionBundle(
  bundle: CachedSessionBundle | null,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  try {
    if (!bundle) {
      storage.removeItem(AUTH_SESSION_CACHE_KEY);
      return;
    }
    storage.setItem(AUTH_SESSION_CACHE_KEY, JSON.stringify(bundle));
  } catch {
    /* ignore quota errors */
  }
}

export function loadLocalWorkspaces(
  userId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): TenantSummary[] {
  if (!storage || !userId) return [];
  try {
    const raw = storage.getItem(localWorkspacesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TenantSummary[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalWorkspaces(
  userId: string,
  workspaces: TenantSummary[],
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage || !userId) return;
  try {
    storage.setItem(localWorkspacesKey(userId), JSON.stringify(workspaces));
  } catch {
    /* ignore */
  }
}

export function loadActiveTenantId(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): string | null {
  if (!storage) return null;
  return storage.getItem(ACTIVE_TENANT_STORAGE_KEY) || null;
}

export function saveActiveTenantId(
  tenantId: string | null,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  if (!tenantId) storage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
  else storage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
}

export function loadTenantOutbox(
  tenantId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): OutboxOp[] {
  if (!storage || !tenantId) return [];
  try {
    const raw = storage.getItem(tenantOutboxKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

export function saveTenantOutbox(
  tenantId: string,
  ops: OutboxOp[],
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage || !tenantId) return;
  try {
    if (ops.length === 0) {
      storage.removeItem(tenantOutboxKey(tenantId));
      return;
    }
    storage.setItem(tenantOutboxKey(tenantId), JSON.stringify(ops));
  } catch {
    /* ignore */
  }
}

export function enqueueTenantOutboxOps(
  tenantId: string,
  newOps: OutboxOp[],
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): OutboxOp[] {
  const existing = loadTenantOutbox(tenantId, storage);
  const byKey = new Map<string, OutboxOp>();
  for (const op of existing) {
    byKey.set(`${op.entityType}:${op.entityId}`, op);
  }
  for (const op of newOps) {
    const key = `${op.entityType}:${op.entityId}`;
    const prev = byKey.get(key);
    if (!prev || op.updatedAtMs >= prev.updatedAtMs) {
      byKey.set(key, op);
    }
  }
  const merged = [...byKey.values()];
  saveTenantOutbox(tenantId, merged, storage);
  return merged;
}

export function loadTenantSyncCursor(
  tenantId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): string | null {
  if (!storage || !tenantId) return null;
  return storage.getItem(tenantCursorKey(tenantId)) || null;
}

export function saveTenantSyncCursor(
  tenantId: string,
  cursorIso: string | null,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage || !tenantId) return;
  if (!cursorIso) storage.removeItem(tenantCursorKey(tenantId));
  else storage.setItem(tenantCursorKey(tenantId), cursorIso);
}

export function loadLegacyMizanV1Raw(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): unknown | null {
  if (!storage) return null;
  if (storage.getItem(LEGACY_MIGRATED_FLAG_KEY)) return null;
  try {
    const raw = storage.getItem("mizan.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function markLegacyMizanV1Migrated(
  tenantId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  storage.setItem(LEGACY_MIGRATED_FLAG_KEY, tenantId);
}

type EntitySpec = {
  entityType: EntityType;
  prop: keyof Data;
  idOf: (item: Record<string, unknown>) => string;
};

const ENTITY_SPECS: EntitySpec[] = [
  { entityType: "tx", prop: "txns", idOf: (x) => String(x.id) },
  { entityType: "person", prop: "people", idOf: (x) => String(x.id) },
  { entityType: "debt", prop: "debts", idOf: (x) => String(x.id) },
  { entityType: "payment", prop: "payments", idOf: (x) => String(x.id) },
  { entityType: "wallet", prop: "wallets", idOf: (x) => String(x.id) },
  { entityType: "transfer", prop: "transfers", idOf: (x) => String(x.id) },
  { entityType: "budget", prop: "budgets", idOf: (x) => String(x.categoryId) },
  { entityType: "goal", prop: "goals", idOf: (x) => String(x.id) },
  { entityType: "goalMove", prop: "goalMoves", idOf: (x) => String(x.id) },
  { entityType: "recurring", prop: "recurring", idOf: (x) => String(x.id) },
  { entityType: "category", prop: "categories", idOf: (x) => String(x.id) },
  { entityType: "debtAudit", prop: "debtLogs", idOf: (x) => String(x.id) },
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Export every entity from a Data snapshot as initial upsert OutboxOps (used for first sync / legacy migration). */
export function snapshotToOutboxOps(data: Data, now: number = Date.now()): OutboxOp[] {
  const ops: OutboxOp[] = [];
  for (const spec of ENTITY_SPECS) {
    const list = Array.isArray(data[spec.prop]) ? (data[spec.prop] as Record<string, unknown>[]) : [];
    for (const item of list) {
      const entityId = spec.idOf(item);
      if (!entityId || entityId === "undefined") continue;
      const itemTs = typeof item.updatedAt === "number" ? item.updatedAt : typeof item.createdAt === "number" ? item.createdAt : now;
      ops.push({
        entityType: spec.entityType,
        entityId,
        payload: { ...item, updatedAt: itemTs },
        updatedAtMs: Math.max(now, itemTs),
        deletedAtMs: null,
      });
    }
  }
  return ops;
}

/** Diff two Data states into entity-level upserts and soft-delete tombstones. */
export function diffFinanceDataToOps(
  prevData: Data,
  nextData: Data,
  now: number = Date.now(),
): OutboxOp[] {
  const ops: OutboxOp[] = [];
  for (const spec of ENTITY_SPECS) {
    const prevList = Array.isArray(prevData[spec.prop]) ? (prevData[spec.prop] as Record<string, unknown>[]) : [];
    const nextList = Array.isArray(nextData[spec.prop]) ? (nextData[spec.prop] as Record<string, unknown>[]) : [];

    const prevMap = new Map<string, Record<string, unknown>>();
    for (const item of prevList) prevMap.set(spec.idOf(item), item);

    const nextMap = new Map<string, Record<string, unknown>>();
    for (const item of nextList) nextMap.set(spec.idOf(item), item);

    for (const [entityId, item] of nextMap) {
      const old = prevMap.get(entityId);
      if (!old || stableJson(old) !== stableJson(item)) {
        const ts = typeof item.updatedAt === "number" && item.updatedAt > 0 ? Math.max(now, item.updatedAt) : now;
        ops.push({
          entityType: spec.entityType,
          entityId,
          payload: { ...item, updatedAt: ts },
          updatedAtMs: ts,
          deletedAtMs: null,
        });
      }
    }

    for (const [entityId, oldItem] of prevMap) {
      if (!nextMap.has(entityId)) {
        ops.push({
          entityType: spec.entityType,
          entityId,
          payload: oldItem,
          updatedAtMs: now,
          deletedAtMs: now,
        });
      }
    }
  }
  return ops;
}

export type RemoteTenantRecord = {
  entity_type: EntityType;
  entity_id: string;
  payload: Record<string, unknown>;
  updated_at_ms: number;
  deleted_at_ms: number | null;
  created_by?: string | null;
  created_by_name?: string | null;
  updated_by?: string | null;
  updated_by_name?: string | null;
  server_updated_at: string;
};

/** Entity-level Last-Write-Wins (LWW) + tombstone merge protecting newer pending outbox edits. */
export function mergeRemoteRecordsIntoData(
  localData: Data,
  remoteRows: RemoteTenantRecord[],
  pendingOutbox: OutboxOp[] = [],
): Data {
  if (!remoteRows.length) return localData;

  const pendingMap = new Map<string, number>();
  for (const op of pendingOutbox) {
    pendingMap.set(`${op.entityType}:${op.entityId}`, op.updatedAtMs);
  }

  const next: Data = { ...localData };
  const specByType = new Map<EntityType, EntitySpec>(ENTITY_SPECS.map((s) => [s.entityType, s]));
  const buckets = new Map<EntityType, Map<string, Record<string, unknown>>>();

  for (const spec of ENTITY_SPECS) {
    const map = new Map<string, Record<string, unknown>>();
    const arr = Array.isArray(localData[spec.prop]) ? (localData[spec.prop] as Record<string, unknown>[]) : [];
    for (const item of arr) {
      map.set(spec.idOf(item), item);
    }
    buckets.set(spec.entityType, map);
  }

  for (const row of remoteRows) {
    const spec = specByType.get(row.entity_type);
    if (!spec) continue;
    const map = buckets.get(row.entity_type);
    if (!map) continue;

    const key = `${row.entity_type}:${row.entity_id}`;
    const pendingTs = pendingMap.get(key);
    if (pendingTs !== undefined && pendingTs > Number(row.updated_at_ms)) {
      continue;
    }

    const existing = map.get(row.entity_id);
    const localTs = existing
      ? Number(existing.updatedAt ?? existing.createdAt ?? 0)
      : 0;

    if (localTs > Number(row.updated_at_ms)) {
      continue;
    }

    if (row.deleted_at_ms !== null && row.deleted_at_ms !== undefined) {
      map.delete(row.entity_id);
      continue;
    }

    const enriched: Record<string, unknown> = {
      ...row.payload,
      updatedAt: Number(row.updated_at_ms),
      ...(row.created_by ? { createdBy: row.created_by } : {}),
      ...(row.created_by_name ? { createdByName: row.created_by_name } : {}),
      ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
      ...(row.updated_by_name ? { updatedByName: row.updated_by_name } : {}),
    };
    map.set(row.entity_id, enriched);
  }

  for (const spec of ENTITY_SPECS) {
    const map = buckets.get(spec.entityType);
    if (!map) continue;
    (next as Record<string, unknown>)[spec.prop as string] = [...map.values()];
  }

  return next;
}

/** Securely overwrite and delete local cached files for one tenant (e.g. on member removal). */
export function wipeTenantCache(
  tenantId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage || !tenantId) return;
  const zeroPad = "0".repeat(256);
  for (const key of [
    tenantDataKey(tenantId),
    tenantOutboxKey(tenantId),
    tenantCursorKey(tenantId),
    tenantUpdatedAtKey(tenantId),
  ]) {
    try {
      if (storage.getItem(key) !== null) {
        storage.setItem(key, zeroPad);
        storage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Wipe all multi-tenant caches and user session caches upon full sign-out. */
export function wipeAllTenantCachesOnSignOut(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  if (!storage) return;
  const zeroPad = "0".repeat(256);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (!k) continue;
    if (
      k.startsWith("mizan.tenant.") ||
      k.startsWith("mizan.user.") ||
      k.startsWith("mizan.auth.") ||
      k === LEGACY_MIGRATED_FLAG_KEY ||
      k === "mizan.supabase.auth.v1" ||
      (MIZAN_LOCAL_STORAGE_KEYS as readonly string[]).includes(k)
    ) {
      keys.push(k);
    }
  }
  for (const k of keys) {
    try {
      storage.setItem(k, zeroPad);
      storage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
