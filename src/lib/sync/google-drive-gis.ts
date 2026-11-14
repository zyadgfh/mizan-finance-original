import { createDriveSyncController, type DriveSyncAdapter, type DriveSyncRecord } from "./drive-sync.ts";

export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_BACKUP_FILENAME = "mizan-backup.json";

const CLIENT_ID_STORAGE_KEY = "mizan.drive.clientId";
const PREFS_STORAGE_KEY = "mizan.drive.prefs";

export type DriveSyncPrefs = {
  autoSync: boolean;
  lastSyncedAt?: number;
};

type DriveFileMeta = {
  id: string;
  headRevisionId?: string;
  version?: string | number;
  modifiedTime?: string;
};

type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (resp: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: TokenClientConfig) => {
          requestAccessToken: (opts?: { prompt?: string }) => void;
        };
        revoke?: (token: string, done?: () => void) => void;
      };
    };
  };
};

let memoryToken: { value: string; expiresAt: number } | null = null;
let gsiLoadPromise: Promise<void> | null = null;

export function getEnvGoogleClientId(): string {
  try {
    const val = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID;
    return typeof val === "string" ? val.trim() : "";
  } catch {
    return "";
  }
}

export function getConfiguredGoogleClientId(storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined): string {
  const envId = getEnvGoogleClientId();
  if (envId) return envId;
  try {
    return storage?.getItem(CLIENT_ID_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setCustomGoogleClientId(
  clientId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
) {
  const trimmed = clientId.trim();
  try {
    if (trimmed) storage?.setItem(CLIENT_ID_STORAGE_KEY, trimmed);
    else storage?.removeItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    /* ignore storage unavailable */
  }
}

export function loadDriveSyncPrefs(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): DriveSyncPrefs {
  try {
    const raw = storage?.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { autoSync: false };
    const parsed = JSON.parse(raw) as Partial<DriveSyncPrefs>;
    return {
      autoSync: Boolean(parsed.autoSync),
      lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return { autoSync: false };
  }
}

export function saveDriveSyncPrefs(
  prefs: DriveSyncPrefs,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
) {
  try {
    storage?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore storage unavailable */
  }
}

export function getCachedGoogleToken(): string | null {
  if (!memoryToken) return null;
  if (Date.now() >= memoryToken.expiresAt - 30_000) {
    memoryToken = null;
    return null;
  }
  return memoryToken.value;
}

export function clearCachedGoogleToken(): void {
  const token = memoryToken?.value;
  memoryToken = null;
  if (token && typeof window !== "undefined") {
    const revoke = (window as GoogleWindow).google?.accounts?.oauth2?.revoke;
    try {
      revoke?.(token);
    } catch {
      /* ignore revoke error */
    }
  }
}

export function loadGsiClient(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Sign-In requires a browser environment"));
  }
  const gw = window as GoogleWindow;
  if (gw.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }
  if (gsiLoadPromise) return gsiLoadPromise;

  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("network: failed to load Google Identity Services")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    const timeout = window.setTimeout(() => {
      gsiLoadPromise = null;
      reject(new Error("timeout loading Google Identity Services"));
    }, 12_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      gsiLoadPromise = null;
      reject(new Error("network: failed to load Google Identity Services"));
    };
    document.head.appendChild(script);
  });

  return gsiLoadPromise;
}

export async function requestGoogleDriveToken(clientId: string, prompt: "" | "consent" | "select_account" = ""): Promise<string> {
  const cached = prompt === "" ? getCachedGoogleToken() : null;
  if (cached) return cached;

  const trimmed = clientId.trim();
  if (!trimmed) throw new Error("unauthorized: Google OAuth Client ID is missing");

  await loadGsiClient();
  const oauth2 = (window as GoogleWindow).google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    throw new Error("Google Identity Services OAuth client unavailable");
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: trimmed,
      scope: DRIVE_APPDATA_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(`401 unauthorized: ${resp.error_description || resp.error || "no token"}`));
          return;
        }
        const ttlMs = Math.max(60, Number(resp.expires_in ?? 3500)) * 1000;
        memoryToken = { value: resp.access_token, expiresAt: Date.now() + ttlMs };
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(`401 unauthorized: ${err.message || err.type || "popup cancelled"}`));
      },
    });
    client.requestAccessToken({ prompt });
  });
}

function revisionOf(meta: DriveFileMeta): string {
  if (meta.headRevisionId) return meta.headRevisionId;
  if (meta.version !== undefined && meta.version !== null) return String(meta.version);
  return meta.modifiedTime ?? "";
}

function buildMultipartRelated(metadata: Record<string, unknown>, jsonBody: string) {
  const boundary = `mizan_${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${jsonBody}\r\n` +
    `--${boundary}--`;
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body,
  };
}

export function createGoogleDriveAppDataAdapter(opts: {
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  fileName?: string;
}): DriveSyncAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fileName = opts.fileName ?? DRIVE_BACKUP_FILENAME;
  let cachedFileId: string | null = null;

  async function authHeaders(extra: Record<string, string> = {}) {
    const token = await opts.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  async function findLatestBackupFile(): Promise<DriveFileMeta | null> {
    const q = encodeURIComponent(`name='${fileName.replace(/'/g, "\\'")}' and trashed=false`);
    const url =
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}` +
      `&fields=files(id,headRevisionId,modifiedTime,version)&orderBy=modifiedTime%20desc&pageSize=1`;
    const res = await fetchImpl(url, { headers: await authHeaders() });
    if (res.status === 401 || res.status === 403) {
      clearCachedGoogleToken();
      throw new Error(`${res.status} unauthorized`);
    }
    if (!res.ok) throw new Error(`Drive list failed: HTTP ${res.status}`);
    const payload = (await res.json()) as { files?: DriveFileMeta[] };
    const first = payload.files?.[0] ?? null;
    cachedFileId = first?.id ?? null;
    return first;
  }

  return {
    async read() {
      const meta = await findLatestBackupFile();
      if (!meta) return null;

      const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}?alt=media`;
      const res = await fetchImpl(mediaUrl, { headers: await authHeaders() });
      if (res.status === 401 || res.status === 403) {
        clearCachedGoogleToken();
        throw new Error(`${res.status} unauthorized`);
      }
      if (res.status === 404) {
        cachedFileId = null;
        return null;
      }
      if (!res.ok) throw new Error(`Drive download failed: HTTP ${res.status}`);

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw new Error("Invalid remote sync payload");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid remote sync payload");
      }
      const record = parsed as DriveSyncRecord;
      return { ...record, revision: revisionOf(meta) };
    },

    async write(record, expectedRevision) {
      const latest = await findLatestBackupFile();
      if (latest) {
        cachedFileId = latest.id;
        const currentRev = revisionOf(latest);
        if (!expectedRevision || (currentRev && currentRev !== expectedRevision)) {
          throw new Error("412 revision conflict");
        }
      } else if (expectedRevision) {
        cachedFileId = null;
        throw new Error("412 revision conflict");
      }

      const jsonBody = JSON.stringify({ ...record, revision: undefined });

      const isUpdate = Boolean(cachedFileId);
      const metadata = isUpdate
        ? { name: fileName, mimeType: "application/json" }
        : { name: fileName, mimeType: "application/json", parents: ["appDataFolder"] };
      const { contentType, body } = buildMultipartRelated(metadata, jsonBody);

      const endpoint = isUpdate
        ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(cachedFileId!)}?uploadType=multipart&fields=id,headRevisionId,modifiedTime,version`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,headRevisionId,modifiedTime,version";

      const res = await fetchImpl(endpoint, {
        method: isUpdate ? "PATCH" : "POST",
        headers: await authHeaders({ "Content-Type": contentType }),
        body,
      });
      if (res.status === 401 || res.status === 403) {
        clearCachedGoogleToken();
        throw new Error(`${res.status} unauthorized`);
      }
      if (res.status === 409 || res.status === 412) {
        throw new Error(`${res.status} revision conflict`);
      }
      if (!res.ok) throw new Error(`Drive upload failed: HTTP ${res.status}`);
      const updatedMeta = (await res.json()) as DriveFileMeta;
      cachedFileId = updatedMeta.id ?? cachedFileId;
      return { revision: revisionOf(updatedMeta) };
    },
  };
}

let sharedController: ReturnType<typeof createDriveSyncController> | null = null;
let sharedClientId = "";

export function getGoogleDriveSyncController(clientId: string) {
  if (!sharedController || sharedClientId !== clientId) {
    sharedClientId = clientId;
    sharedController = createDriveSyncController(
      createGoogleDriveAppDataAdapter({
        getAccessToken: () => requestGoogleDriveToken(clientId),
      }),
    );
  }
  return sharedController;
}

export function resetGoogleDriveSyncController() {
  sharedController = null;
  sharedClientId = "";
}
