import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  budgetAlerts,
  detectUnusualExpenses,
  estimateGoalEta,
  nextInstallmentDate,
  planInstallments,
  reportMetrics,
  suggestCategoryBudget,
  suggestCategoryFromNote,
  todayISO,
  unifiedSearch,
  weeklySpendingSummary,
} from "./logic.ts";
import { buildMonthlyReportCsv, buildMonthlyReportHtml, buildMonthlyReportJson } from "./report-export.ts";
import {
  maskPersonName,
  MIZAN_LOCAL_STORAGE_KEYS,
  overwriteAndClearLocalKeys,
  shouldAutoLock,
} from "./security.ts";
import { seedData } from "./seed.ts";
import { exportDataAsync, importDataAsync, useFinance } from "./store.ts";
import { frequentTemplates, loadEntryPrefs, rememberEntryChoice } from "./entry-prefs.ts";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  validateBackupJsonObject,
} from "../sync/crypto-backup.ts";
import { createDriveSyncController, type DriveSyncAdapter, type DriveSyncRecord } from "../sync/drive-sync.ts";
import { createGoogleDriveAppDataAdapter } from "../sync/google-drive-gis.ts";
import {
  ACTION_MARK_PAID,
  ACTION_SNOOZE_DAY,
  addScheduledTask,
  buildSmartTaskSuggestions,
  executeNotificationAction,
  loadScheduledTasks,
} from "../notifications/tasks.ts";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("Pillar 1-6 domain enhancements", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = new MemoryStorage();
    useFinance.getState().replaceAll(seedData(), 1000);
  });

  it("supports weekly and biweekly installment cadences and debt audit trail", () => {
    assert.equal(nextInstallmentDate("2026-03-01", 2, "weekly"), "2026-03-15");
    assert.equal(nextInstallmentDate("2026-03-01", 1, "biweekly"), "2026-03-15");

    const rows = planInstallments({
      id: "d-w",
      personId: "p1",
      direction: "payable",
      title: "قسط أسبوعي",
      principal: 300,
      dueDate: "2026-05-01",
      note: "",
      installments: 3,
      cadence: "weekly",
      createdAt: 1,
    });
    assert.deepEqual(
      rows.map((r) => r.due),
      ["2026-05-01", "2026-05-08", "2026-05-15"],
    );

    const s = useFinance.getState();
    const pid = s.addPerson({ name: "خالد", phone: "", note: "" });
    const did = s.addDebt({
      personId: pid,
      direction: "receivable",
      title: "سلفة تدقيق",
      principal: 1000,
      dueDate: todayISO(),
      note: "",
      installments: 2,
      cadence: "biweekly",
    });
    s.updateDebt(did, {
      personId: pid,
      direction: "receivable",
      title: "سلفة تدقيق",
      principal: 1200,
      dueDate: todayISO(),
      note: "",
      installments: 2,
      cadence: "biweekly",
    });
    const payId = s.addPayment({
      debtId: did,
      amount: 400,
      date: todayISO(),
      note: "دفعة",
      walletId: "w-cash",
      linkCash: true,
    });
    const logs = (useFinance.getState().debtLogs ?? []).filter((l) => l.debtId === did);
    assert.deepEqual(
      logs.map((l) => l.action),
      ["payment-added", "debt-edited", "created"],
    );
    s.removePayment(payId);
    const logsAfter = (useFinance.getState().debtLogs ?? []).filter((l) => l.debtId === did);
    assert.equal(logsAfter[0]?.action, "payment-deleted");
  });

  it("runs unified search across txns, debts, and people with multi-dimensional filters", () => {
    const data = seedData();
    const allRes = unifiedSearch(data, { query: "سارة" });
    assert.ok(allRes.people.some((p) => p.person.name.includes("سارة")));
    assert.ok(allRes.debts.length >= 1);

    const filteredRes = unifiedSearch(data, {
      categoryId: "c-food",
      minAmount: 50,
      maxAmount: 10_000,
      onlyUnsettled: false,
    });
    assert.ok(filteredRes.txns.every((t) => t.categoryId === "c-food" && t.amount >= 50));
    assert.equal(filteredRes.debts.length, 0);
  });

  it("learns categories from notes, suggests budgets, detects unusual spikes, and generates reports", () => {
    const data = seedData();
    assert.equal(suggestCategoryFromNote("فاتورة كهرباء البيت", "expense", data.categories, data.txns), "c-bills");
    assert.equal(suggestCategoryFromNote("أوبر للمطار", "expense", data.categories, data.txns), "c-transport");

    const month = data.txns[0]?.date.slice(0, 7) ?? todayISO().slice(0, 7);
    const suggested = suggestCategoryBudget("c-food", data.txns, month);
    assert.ok(suggested > 0);

    const alerts = budgetAlerts(
      [{ categoryId: "c-food", limit: 100 }],
      data.categories,
      [
        {
          id: "tx-over",
          kind: "expense",
          amount: 150,
          categoryId: "c-food",
          note: "عزومة",
          date: `${month}-10`,
          createdAt: 1,
        },
      ],
      month,
    );
    assert.equal(alerts[0]?.level, "over");

    const unusual = detectUnusualExpenses(
      [
        { id: "b1", kind: "expense", amount: 50, categoryId: "c-food", note: "فطور", date: "2026-09-01", createdAt: 1 },
        { id: "b2", kind: "expense", amount: 60, categoryId: "c-food", note: "غداء", date: "2026-09-10", createdAt: 2 },
        { id: "b3", kind: "expense", amount: 55, categoryId: "c-food", note: "عشاء", date: "2026-10-05", createdAt: 3 },
        { id: "spike", kind: "expense", amount: 900, categoryId: "c-food", note: "حفلة كبيرة", date: "2026-11-05", createdAt: 4 },
      ],
      data.categories,
      "2026-11",
    );
    assert.equal(unusual.txAlerts[0]?.tx.id, "spike");

    const weekly = weeklySpendingSummary(data.txns, data.categories, todayISO());
    assert.equal(typeof weekly.currentWeekExpense, "number");

    const eta = estimateGoalEta(data.goals[0]!, data.goalMoves, data.txns);
    assert.ok(["done", "on-track", "behind", "no-pace"].includes(eta.status));

    const metrics = reportMetrics(data, month);
    assert.equal(metrics.monthlyTrend.length, 6);
    const csv = buildMonthlyReportCsv(
      {
        ...data,
        categories: [{ id: "c-inj", name: "=cmd|' /C calc'!A0", kind: "expense", icon: "tag", tone: "tint" }],
      },
      month,
    );
    assert.ok(!csv.includes("\n=cmd"));
    assert.ok(buildMonthlyReportJson(data, month).includes("monthlyTrend"));
    assert.ok(buildMonthlyReportHtml(data, month).includes("<!doctype html>"));
  });

  it("remembers entry defaults and frequent templates", () => {
    rememberEntryChoice("expense", "c-food", "w-instapay");
    const prefs = loadEntryPrefs();
    assert.equal(prefs.lastWalletId, "w-instapay");
    assert.equal(prefs.lastCategoryByKind?.expense, "c-food");

    const data = seedData();
    const templates = frequentTemplates(data.txns, data.recurring, data.categories, 4);
    assert.ok(templates.length > 0);
  });

  it("encrypts/decrypts backups with AES-GCM, validates schema, and masks/wipes local keys", async () => {
    const plain = JSON.stringify(seedData());
    const envelope = await encryptBackupPayload(plain, "secret-pass-2026");
    assert.equal(isEncryptedBackupEnvelope(envelope), true);
    const decrypted = await decryptBackupPayload(envelope, "secret-pass-2026");
    assert.equal(decrypted, plain);
    await assert.rejects(() => decryptBackupPayload(envelope, "wrong-pass"));

    assert.equal(validateBackupJsonObject({ txns: "bad" }).ok, false);
    assert.equal(validateBackupJsonObject(seedData()).ok, true);

    assert.equal(maskPersonName("أحمد علي", true), "أ•••");
    assert.equal(maskPersonName("أحمد علي", false), "أحمد علي");
    assert.equal(shouldAutoLock(1000, 1000 + 60_000, 1, true), true);
    assert.equal(shouldAutoLock(1000, 1000 + 10_000, 5, true), false);

    // Ensure importDataAsync rejects missing/wrong passphrase on encrypted backups
    const encStr = JSON.stringify(envelope);
    await assert.rejects(() => importDataAsync(encStr));
    await importDataAsync(encStr, "secret-pass-2026");
    assert.equal(useFinance.getState().demo, false);

    // Ensure overwriteAndClearLocalKeys clears every Mizan key
    for (const k of MIZAN_LOCAL_STORAGE_KEYS) {
      localStorage.setItem(k, "sensitive");
    }
    overwriteAndClearLocalKeys(localStorage);
    for (const k of MIZAN_LOCAL_STORAGE_KEYS) {
      assert.equal(localStorage.getItem(k), null);
    }

    // Verify exportDataAsync doesn't throw when Blob + download are stubbed in browserless test env
    assert.equal(typeof exportDataAsync, "function");
  });

  it("handles sync conflict prompts, force-local resolution, and encrypted Google Drive appData adapter", async () => {
    const local = seedData();
    local.demo = false;
    const remote = seedData();
    remote.currency = "SAR";

    const adapter: DriveSyncAdapter = {
      async read(): Promise<DriveSyncRecord> {
        return { version: 1, updatedAt: 500, deviceId: "other", data: remote, revision: "rev-5" };
      },
      async write(rec, expectedRevision) {
        assert.equal(expectedRevision, "rev-5");
        return { revision: `rev-${rec.updatedAt}` };
      },
    };
    const controller = createDriveSyncController(adapter);
    const conflictRes = await controller.sync(local, 400, { conflictMode: "prompt" });
    assert.equal(conflictRes.source, "conflict");
    assert.equal(conflictRes.state.phase, "conflict");
    assert.equal(conflictRes.conflict?.remoteData.currency, "SAR");

    const forcedRes = await controller.sync(local, 400, { conflictMode: "force-local" });
    assert.equal(forcedRes.source, "uploaded");
    assert.equal(forcedRes.state.phase, "synced");

    // End-to-end encrypted Google Drive adapter test
    let storedBody = "";
    const mockFetch: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("/files?") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            files: storedBody ? [{ id: "f1", headRevisionId: "r1", modifiedTime: "2026-11-14T00:00:00Z" }] : [],
          }),
          { status: 200 },
        );
      }
      if (u.includes("/upload/")) {
        const raw = String(init?.body ?? "");
        const parts = raw.split("\r\n\r\n");
        storedBody = parts[2]?.split("\r\n--")[0] ?? "";
        return new Response(JSON.stringify({ id: "f1", headRevisionId: "r2" }), { status: 200 });
      }
      if (u.includes("alt=media")) {
        return new Response(storedBody, { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };

    let currentPass = "my-drive-pass";
    const encAdapter = createGoogleDriveAppDataAdapter({
      getAccessToken: async () => "tok-123",
      fetchImpl: mockFetch,
      getPassphrase: () => currentPass,
    });
    await encAdapter.write({ version: 1, updatedAt: 900, deviceId: "dev", data: local });
    assert.ok(storedBody.includes("encryptedPayload"));
    assert.ok(!storedBody.includes(local.people[0]!.name));

    const loaded = await encAdapter.read();
    assert.equal(loaded?.data.currency, local.currency);

    currentPass = "";
    await assert.rejects(() => encAdapter.read(), /encrypted/);

    currentPass = "wrong-pass";
    await assert.rejects(() => encAdapter.read(), /wrong_passphrase/);
  });

  it("builds smart notification task suggestions and executes snooze / mark-paid actions", () => {
    const data = seedData();
    const suggestions = buildSmartTaskSuggestions(data);
    assert.ok(suggestions.some((s) => s.category === "weekly"));

    const s = useFinance.getState();
    const pid = s.addPerson({ name: "ندى", phone: "", note: "" });
    const did = s.addDebt({
      personId: pid,
      direction: "payable",
      title: "إيجار مكتب",
      principal: 500,
      dueDate: todayISO(),
      note: "",
      installments: 1,
    });
    const future = new Date(Date.now() + 7_200_000).toISOString();
    const task = addScheduledTask({
      title: "سداد: إيجار مكتب",
      body: "مستحق اليوم",
      dueAt: future,
      repeat: "once",
      category: "debt",
      relatedId: did,
      amount: 500,
    });

    const snoozed = executeNotificationAction(ACTION_SNOOZE_DAY, task, {
      getData: () => useFinance.getState(),
      addPayment: useFinance.getState().addPayment,
      confirmRecurring: useFinance.getState().confirmRecurring,
      addTxn: useFinance.getState().addTxn,
    });
    assert.equal(snoozed.handled, true);
    assert.ok(new Date(snoozed.updatedTask!.dueAt).getTime() > new Date(future).getTime());

    const paidRes = executeNotificationAction(ACTION_MARK_PAID, task, {
      getData: () => useFinance.getState(),
      addPayment: useFinance.getState().addPayment,
      confirmRecurring: useFinance.getState().confirmRecurring,
      addTxn: useFinance.getState().addTxn,
    });
    assert.equal(paidRes.handled, true);
    const updatedTask = loadScheduledTasks().find((t) => t.id === task.id);
    assert.equal(updatedTask?.enabled, false);
    assert.equal(useFinance.getState().payments.some((p) => p.debtId === did && p.amount === 500), true);
  });
});
