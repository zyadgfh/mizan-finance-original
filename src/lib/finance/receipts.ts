import { getSupabaseClient } from "../supabase/client.ts";

const DB = "mizan-receipts";
const STORE = "files";
const BUCKET = "mizan-receipts";

type ReceiptSyncScope = {
  tenantId: string | null;
  mode: "cloud" | "local";
  canWrite: boolean;
};

let activeScope: ReceiptSyncScope = {
  tenantId: null,
  mode: "local",
  canWrite: true,
};

export function configureReceiptSyncScope(next: Partial<ReceiptSyncScope>) {
  activeScope = { ...activeScope, ...next };
}

function scopedDbKey(id: string, tenantId = activeScope.tenantId): string {
  return tenantId ? `${tenantId}/${id}` : id;
}

function uploadQueueKey(tenantId: string): string {
  return `mizan.receiptUploads.${tenantId}.v1`;
}

function deleteQueueKey(tenantId: string): string {
  return `mizan.receiptDeletes.${tenantId}.v1`;
}

function readQueue(key: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeQueue(key: string, items: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    const unique = Array.from(new Set(items.filter(Boolean)));
    if (unique.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(unique));
  } catch {
    /* ignore storage quota */
  }
}

function isOnlineNow(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putIdbBlob(key: string, blob: Blob) {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getIdbBlob(key: string): Promise<Blob | undefined> {
  if (!hasIndexedDb()) return undefined;
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

async function deleteIdbKey(key: string) {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function storageObjectPath(tenantId: string, receiptId: string): string {
  const cleanId = receiptId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${tenantId}/${cleanId}.jpg`;
}

async function uploadReceiptToCloud(tenantId: string, id: string, blob: Blob): Promise<boolean> {
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.storage.from(BUCKET).upload(storageObjectPath(tenantId, id), blob, {
      upsert: true,
      contentType: blob.type || "image/jpeg",
    });
    return !error;
  } catch {
    return false;
  }
}

export async function saveReceipt(id: string, blob: Blob) {
  const { tenantId, mode, canWrite } = activeScope;
  await putIdbBlob(scopedDbKey(id, tenantId), blob);

  if (mode === "cloud" && tenantId && canWrite) {
    const delQ = readQueue(deleteQueueKey(tenantId)).filter((x) => x !== id);
    writeQueue(deleteQueueKey(tenantId), delQ);

    const upQ = readQueue(uploadQueueKey(tenantId));
    writeQueue(uploadQueueKey(tenantId), [...upQ, id]);

    if (isOnlineNow()) {
      const ok = await uploadReceiptToCloud(tenantId, id, blob);
      if (ok) {
        writeQueue(
          uploadQueueKey(tenantId),
          readQueue(uploadQueueKey(tenantId)).filter((x) => x !== id),
        );
      }
    }
  }
}

export async function loadReceipt(id: string) {
  const { tenantId, mode } = activeScope;
  const primaryKey = scopedDbKey(id, tenantId);
  const localBlob = await getIdbBlob(primaryKey);
  if (localBlob) return localBlob;

  // Fallback to unscoped legacy key if migrated from single-user store
  if (tenantId) {
    const legacyBlob = await getIdbBlob(id);
    if (legacyBlob) {
      await putIdbBlob(primaryKey, legacyBlob);
      return legacyBlob;
    }
  }

  // Pull from Supabase Storage when in cloud workspace and cache locally
  if (mode === "cloud" && tenantId && isOnlineNow()) {
    try {
      const sb = getSupabaseClient();
      const { data, error } = await sb.storage.from(BUCKET).download(storageObjectPath(tenantId, id));
      if (!error && data) {
        await putIdbBlob(primaryKey, data);
        return data;
      }
    } catch {
      /* offline or object not uploaded yet */
    }
  }

  return undefined;
}

export async function deleteReceipt(id: string) {
  const { tenantId, mode, canWrite } = activeScope;
  await deleteIdbKey(scopedDbKey(id, tenantId));
  if (tenantId) await deleteIdbKey(id);

  if (mode === "cloud" && tenantId && canWrite) {
    writeQueue(
      uploadQueueKey(tenantId),
      readQueue(uploadQueueKey(tenantId)).filter((x) => x !== id),
    );
    writeQueue(deleteQueueKey(tenantId), [...readQueue(deleteQueueKey(tenantId)), id]);

    if (isOnlineNow()) {
      try {
        const sb = getSupabaseClient();
        const { error } = await sb.storage.from(BUCKET).remove([storageObjectPath(tenantId, id)]);
        if (!error) {
          writeQueue(
            deleteQueueKey(tenantId),
            readQueue(deleteQueueKey(tenantId)).filter((x) => x !== id),
          );
        }
      } catch {
        /* keep queued for next sync */
      }
    }
  }
}

export async function flushPendingReceiptSync(tenantId: string): Promise<void> {
  if (!tenantId || !isOnlineNow()) return;

  const pendingUploads = readQueue(uploadQueueKey(tenantId));
  if (pendingUploads.length > 0) {
    const remainingUploads: string[] = [];
    for (const id of pendingUploads) {
      const blob = (await getIdbBlob(scopedDbKey(id, tenantId))) ?? (await getIdbBlob(id));
      if (!blob) continue;
      const ok = await uploadReceiptToCloud(tenantId, id, blob);
      if (!ok) remainingUploads.push(id);
    }
    writeQueue(uploadQueueKey(tenantId), remainingUploads);
  }

  const pendingDeletes = readQueue(deleteQueueKey(tenantId));
  if (pendingDeletes.length > 0) {
    try {
      const sb = getSupabaseClient();
      const paths = pendingDeletes.map((id) => storageObjectPath(tenantId, id));
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (!error) {
        writeQueue(deleteQueueKey(tenantId), []);
      }
    } catch {
      /* retry next sync */
    }
  }
}

export async function purgeTenantReceiptsCache(tenantId: string): Promise<void> {
  if (!tenantId) return;
  writeQueue(uploadQueueKey(tenantId), []);
  writeQueue(deleteQueueKey(tenantId), []);
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const prefix = `${tenantId}/`;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        for (const k of keysReq.result ?? []) {
          if (String(k).startsWith(prefix)) store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore IndexedDB errors in restricted contexts */
  }
}

export async function purgeAllReceiptsOnSignOut(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* fall through to deleteDatabase attempt */
  }
  try {
    if (typeof indexedDB.deleteDatabase === "function") {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  } catch {
    /* ignore */
  }
}

export async function clearReceipts() {
  if (!hasIndexedDb()) return;
  const { tenantId } = activeScope;
  const db = await openDb();
  if (!tenantId) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return;
  }

  const prefix = `${tenantId}/`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      for (const k of keysReq.result ?? []) {
        const s = String(k);
        if (s.startsWith(prefix)) store.delete(k);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportAllReceipts(): Promise<Record<string, string>> {
  if (!hasIndexedDb()) return {};
  const { tenantId } = activeScope;
  const prefix = tenantId ? `${tenantId}/` : "";
  const db = await openDb();
  const entries = await new Promise<Array<[string, Blob]>>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = (keysReq.result ?? []).map(String);
      const vals = (valsReq.result ?? []) as Blob[];
      const pairs: Array<[string, Blob]> = [];
      keys.forEach((k, i) => {
        const b = vals[i];
        if (!b) return;
        if (prefix) {
          if (k.startsWith(prefix)) pairs.push([k.slice(prefix.length), b]);
        } else if (!k.includes("/")) {
          pairs.push([k, b]);
        }
      });
      resolve(pairs);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const out: Record<string, string> = {};
  for (const [id, blob] of entries) {
    out[id] = await blobToDataUrl(blob);
  }
  return out;
}

export async function importAllReceipts(receipts: Record<string, string>) {
  if (!hasIndexedDb()) return;
  await clearReceipts();
  const entries = Object.entries(receipts).filter(([, v]) => typeof v === "string" && v.startsWith("data:"));
  if (entries.length === 0) return;
  const { tenantId, mode, canWrite } = activeScope;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [id, dataUrl] of entries) {
      const blob = dataUrlToBlob(dataUrl);
      if (blob) store.put(blob, scopedDbKey(id, tenantId));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  if (mode === "cloud" && tenantId && canWrite) {
    const ids = entries.map(([id]) => id);
    writeQueue(uploadQueueKey(tenantId), [...readQueue(uploadQueueKey(tenantId)), ...ids]);
    void flushPendingReceiptSync(tenantId);
  }
}

export async function compressReceipt(file: File) {
  const sourceBlob =
    file.type && file.type.startsWith("image/") ? file : new Blob([file], { type: "image/jpeg" });

  let width = 800;
  let height = 800;
  let drawToCanvas: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null = null;
  let cleanup: (() => void) | null = null;

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(sourceBlob);
      width = bitmap.width;
      height = bitmap.height;
      drawToCanvas = (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h);
      cleanup = () => bitmap.close();
    } catch {
      /* fallback to Image element for older iOS / Android WebViews */
    }
  }

  if (!drawToCanvas) {
    const objectUrl = URL.createObjectURL(sourceBlob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("image"));
      };
      el.src = objectUrl;
    });
    width = img.naturalWidth || img.width || 800;
    height = img.naturalHeight || img.height || 800;
    drawToCanvas = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
    cleanup = () => URL.revokeObjectURL(objectUrl);
  }

  try {
    const max = 960;
    const scale = Math.min(1, max / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    drawToCanvas(ctx, w, h);

    for (const quality of [0.72, 0.56, 0.42]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
      if (blob && (blob.size <= 430_000 || quality === 0.42)) {
        return blob;
      }
    }
    throw new Error("blob");
  } finally {
    cleanup?.();
  }
}
