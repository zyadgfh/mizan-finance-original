import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDriveSyncController,
  type DriveSyncAdapter,
  type DriveSyncRecord,
} from "./drive-sync.ts";
import type { Data } from "../finance/types.ts";

function fixture(): Data {
  return {
    txns: [],
    people: [],
    debts: [],
    payments: [],
    categories: [],
    budgets: [],
    openingBalance: 0,
    currency: "EGP",
    demo: true,
    wallets: [],
    transfers: [],
    recurring: [],
    goals: [],
    goalMoves: [],
  };
}

function adapterWith(remote: DriveSyncRecord | null, options: { readError?: Error; writeError?: Error; delay?: number } = {}) {
  const writes: Array<{ record: DriveSyncRecord; expectedRevision?: string }> = [];
  const adapter: DriveSyncAdapter = {
    async read() {
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      if (options.readError) throw options.readError;
      return remote;
    },
    async write(record, expectedRevision) {
      if (options.writeError) throw options.writeError;
      writes.push({ record, expectedRevision });
      return { revision: `revision-${writes.length}` };
    },
  };
  return { adapter, writes };
}

function record(data: ReturnType<typeof fixture>, updatedAt: number, revision = "r-1"): DriveSyncRecord {
  return { version: 1, updatedAt, deviceId: "other-device", data, revision };
}

describe("Google Drive sync controller", () => {
  it("uploads local data when the appData file does not exist", async () => {
    const local = fixture();
    const { adapter, writes } = adapterWith(null);
    const result = await createDriveSyncController(adapter).sync(local, 100);

    assert.equal(result.source, "uploaded");
    assert.equal(result.state.phase, "synced");
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.record.updatedAt, 100);
    assert.deepEqual(writes[0]?.record.data, local);
  });

  it("restores the remote snapshot when it is newer than local data", async () => {
    const local = fixture();
    const remote = fixture();
    remote.currency = "USD";
    const { adapter, writes } = adapterWith(record(remote, 200));
    const result = await createDriveSyncController(adapter).sync(local, 100);

    assert.equal(result.source, "remote");
    assert.equal(result.data.currency, "USD");
    assert.equal(writes.length, 0);
    assert.equal(result.state.phase, "synced");
  });

  it("uploads local data with the remote revision when local data is newer", async () => {
    const local = fixture();
    local.demo = false;
    const { adapter, writes } = adapterWith(record(fixture(), 100, "remote-revision"));
    const result = await createDriveSyncController(adapter).sync(local, 200);

    assert.equal(result.source, "uploaded");
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.expectedRevision, "remote-revision");
    assert.equal(writes[0]?.record.updatedAt, 200);
    assert.equal(writes[0]?.record.deviceId, "current-device");
  });

  it("does not rewrite Drive when timestamps are equal", async () => {
    const local = fixture();
    const { adapter, writes } = adapterWith(record(fixture(), 100));
    const result = await createDriveSyncController(adapter).sync(local, 100);

    assert.equal(result.source, "local");
    assert.equal(writes.length, 0);
    assert.equal(result.state.phase, "synced");
  });

  it("rejects malformed remote records and safely returns local data", async () => {
    const local = fixture();
    const { adapter } = adapterWith({ version: 1, updatedAt: 200, deviceId: "bad", data: {} } as DriveSyncRecord);
    const controller = createDriveSyncController(adapter);
    const result = await controller.sync(local, 100);

    assert.equal(result.source, "local-fallback");
    assert.deepEqual(result.data, local);
    assert.equal(result.state.phase, "error");
    assert.equal(result.state.errorCode, "invalid-remote");
    assert.notEqual(controller.getState().phase, "syncing");
  });

  it("falls back immediately when Drive is offline", async () => {
    const local = fixture();
    const { adapter } = adapterWith(null, { readError: new Error("network offline") });
    const result = await createDriveSyncController(adapter).sync(local, 100);

    assert.equal(result.source, "local-fallback");
    assert.equal(result.state.errorCode, "network");
    assert.equal(result.state.phase, "error");
  });

  it("classifies expired Google authorization without leaving a loading state", async () => {
    const local = fixture();
    const { adapter } = adapterWith(null, { readError: new Error("401 unauthorized") });
    const controller = createDriveSyncController(adapter);
    const phases: string[] = [];
    controller.subscribe((state) => phases.push(state.phase));

    const result = await controller.sync(local, 100);

    assert.equal(result.source, "local-fallback");
    assert.equal(result.state.errorCode, "unauthorized");
    assert.deepEqual(phases, ["syncing", "error"]);
  });

  it("exposes a conflict error and preserves local data when conditional write fails", async () => {
    const local = fixture();
    const { adapter } = adapterWith(record(fixture(), 100), { writeError: new Error("412 revision conflict") });
    const result = await createDriveSyncController(adapter).sync(local, 200);

    assert.equal(result.source, "local-fallback");
    assert.deepEqual(result.data, local);
    assert.equal(result.state.errorCode, "conflict");
    assert.equal(result.state.phase, "error");
  });

  it("deduplicates concurrent sync calls and never creates two writes", async () => {
    const local = fixture();
    const { adapter, writes } = adapterWith(null, { delay: 10 });
    const controller = createDriveSyncController(adapter);
    const [first, second] = await Promise.all([controller.sync(local, 100), controller.sync(local, 100)]);

    assert.strictEqual(first, second);
    assert.equal(writes.length, 1);
    assert.equal(controller.getState().phase, "synced");
  });

  it("allows a later retry after a failed request", async () => {
    const local = fixture();
    let fail = true;
    const adapter: DriveSyncAdapter = {
      async read() {
        if (fail) throw new Error("timeout");
        return null;
      },
      async write() {
        return { revision: "ok" };
      },
    };
    const controller = createDriveSyncController(adapter);
    const first = await controller.sync(local, 100);
    assert.equal(first.source, "local-fallback");
    fail = false;
    const second = await controller.sync(local, 100);
    assert.equal(second.source, "uploaded");
    assert.equal(second.state.phase, "synced");
  });
});
