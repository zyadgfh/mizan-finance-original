import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedData } from "../finance/seed.ts";
import { createDriveSyncController, SYNC_VERSION } from "./drive-sync.ts";
import { createGoogleDriveAppDataAdapter } from "./google-drive-gis.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createGoogleDriveAppDataAdapter", () => {
  it("returns null when no backup file exists in appDataFolder", async () => {
    const calls: string[] = [];
    const adapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "tok-1",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return jsonResponse({ files: [] });
      },
    });
    const rec = await adapter.read();
    assert.equal(rec, null);
    assert.match(calls[0], /spaces=appDataFolder/);
  });

  it("reads backup file media and attaches revision metadata", async () => {
    const data = seedData();
    const payload = { version: SYNC_VERSION, updatedAt: 123456, deviceId: "dev-a", data };
    let step = 0;
    const adapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "tok-1",
      fetchImpl: async () => {
        step += 1;
        if (step === 1) {
          return jsonResponse({ files: [{ id: "file-9", headRevisionId: "rev-42" }] });
        }
        return jsonResponse(payload);
      },
    });
    const rec = await adapter.read();
    assert.equal(rec?.revision, "rev-42");
    assert.equal(rec?.updatedAt, 123456);
    assert.equal(rec?.data.currency, data.currency);
  });

  it("surfaces 401 as unauthorized in sync controller", async () => {
    const adapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "bad-tok",
      fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401),
    });
    const controller = createDriveSyncController(adapter);
    const res = await controller.sync(seedData(), 100);
    assert.equal(res.source, "local-fallback");
    assert.equal(res.state.errorCode, "unauthorized");
  });

  it("surfaces corrupt remote JSON as invalid-remote without touching local state", async () => {
    let step = 0;
    const adapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "tok-1",
      fetchImpl: async () => {
        step += 1;
        if (step === 1) return jsonResponse({ files: [{ id: "file-1", headRevisionId: "rev-1" }] });
        return new Response("{not-json", { status: 200 });
      },
    });
    const controller = createDriveSyncController(adapter);
    const local = seedData();
    const res = await controller.sync(local, 100);
    assert.equal(res.source, "local-fallback");
    assert.equal(res.state.errorCode, "invalid-remote");
    assert.deepEqual(res.data, local);
  });

  it("creates new file in appDataFolder when remote is absent and patches on update", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    let exists = false;
    const adapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "tok-1",
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
        if (url.includes("/files?spaces=appDataFolder")) {
          return jsonResponse({ files: exists ? [{ id: "file-new", headRevisionId: "rev-1" }] : [] });
        }
        if (url.includes("/upload/drive/v3/files") && method === "POST") {
          exists = true;
          return jsonResponse({ id: "file-new", headRevisionId: "rev-1" });
        }
        if (url.includes("/upload/drive/v3/files/file-new") && method === "PATCH") {
          return jsonResponse({ id: "file-new", headRevisionId: "rev-2" });
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      },
    });

    const data = seedData();
    const w1 = await adapter.write({ version: SYNC_VERSION, updatedAt: 100, deviceId: "d1", data });
    assert.equal(w1.revision, "rev-1");
    assert.match(requests[1].body ?? "", /appDataFolder/);

    const w2 = await adapter.write({ version: SYNC_VERSION, updatedAt: 200, deviceId: "d1", data }, "rev-1");
    assert.equal(w2.revision, "rev-2");
    assert.equal(requests[3].method, "PATCH");

    await assert.rejects(
      adapter.write({ version: SYNC_VERSION, updatedAt: 300, deviceId: "d1", data }, "stale-rev"),
      /412 revision conflict/,
    );
  });
});
