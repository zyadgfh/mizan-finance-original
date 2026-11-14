import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  cashPosition,
  currentMonth,
  debtTotals,
  defaultCountryCodeForCurrency,
  installmentRows,
  normalizeSearch,
  remaining,
  sumKind,
  todayISO,
  walletBalance,
  whatsappHref,
} from "./logic.ts";
import { seedData } from "./seed.ts";
import { asData, getLocalUpdatedAt, pickFinanceData, setLocalUpdatedAt, useFinance } from "./store.ts";

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

describe("finance logic", () => {
  it("formats whatsappHref respecting +, 00, and currency country codes", () => {
    assert.equal(whatsappHref("+966501234567", "hi", "20"), "https://wa.me/966501234567?text=hi");
    assert.equal(whatsappHref("00971501234567", "hi", "20"), "https://wa.me/971501234567?text=hi");
    assert.equal(whatsappHref("01001234567", "hi", "20"), "https://wa.me/201001234567?text=hi");
    assert.equal(whatsappHref("0501234567", "hi", defaultCountryCodeForCurrency("SAR")), "https://wa.me/966501234567?text=hi");
    assert.equal(whatsappHref("0501234567", "hi", defaultCountryCodeForCurrency("AED")), "https://wa.me/971501234567?text=hi");
    assert.equal(whatsappHref("", "hi", "20"), "");
  });

  it("normalizes Arabic alef/taa-marbuta/tashkeel and Latin case for search", () => {
    assert.equal(normalizeSearch("أَحْمَد عَادِل"), "احمد عادل");
    assert.equal(normalizeSearch("فاتورة كهرباء"), "فاتوره كهرباء");
    assert.equal(normalizeSearch("InstaPay"), "instapay");
  });

  it("computes wallet balances, cash position, and excludes reported:false from summary", () => {
    const data = seedData();
    const expectedCash = data.wallets.reduce((sum, w) => sum + walletBalance(w.id, data), 0);
    assert.equal(cashPosition(data), expectedCash);

    const month = currentMonth();
    const txnsWithDebtPayment = [
      ...data.txns,
      {
        id: "t-unreported",
        kind: "expense" as const,
        amount: 500,
        categoryId: "c-debt-out",
        note: "سداد دين",
        date: todayISO(),
        source: "debt" as const,
        reported: false,
        createdAt: Date.now(),
      },
    ];
    const expenseSum = sumKind(txnsWithDebtPayment, "expense", month);
    const manualExpenseSum = data.txns
      .filter((t) => t.kind === "expense" && t.reported !== false && t.date.startsWith(month))
      .reduce((s, t) => s + t.amount, 0);
    assert.equal(expenseSum, Math.round(manualExpenseSum * 100) / 100);
  });

  it("allocates installment rows and totals cleanly", () => {
    const data = seedData();
    const totals = debtTotals(data.debts, data.payments);
    assert.ok(totals.receivable > 0);
    assert.ok(totals.payable > 0);

    const splitDebt = data.debts.find((d) => (d.installments ?? 1) > 1);
    assert.ok(splitDebt);
    const rows = installmentRows(splitDebt, data.payments);
    assert.equal(rows.length, splitDebt.installments ?? 1);
    const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
    assert.equal(Math.round(totalRemaining * 100) / 100, remaining(splitDebt, data.payments));
  });
});

describe("finance store mutations & edge-case fixes", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
    useFinance.getState().replaceAll(seedData(), 1000);
  });

  it("syncs linked payment when updating a debt-sourced transaction and rejects over-principal edits", () => {
    const state = useFinance.getState();
    const personId = state.addPerson({ name: "علي", phone: "01000000000", note: "" });
    const debtId = state.addDebt({
      personId,
      direction: "payable",
      title: "سلفة",
      principal: 500,
      dueDate: todayISO(),
      note: "",
      installments: 1,
    });
    const payId = state.addPayment({
      debtId,
      amount: 200,
      date: todayISO(),
      note: "دفعة أولى",
      walletId: "w-cash",
      linkCash: true,
    });
    const payment = useFinance.getState().payments.find((p) => p.id === payId)!;
    assert.ok(payment.txId);

    const updatedOk = useFinance.getState().updateTxn(payment.txId!, {
      kind: "expense",
      amount: 350,
      categoryId: "c-debt-out",
      note: "تعديل الدفعة",
      date: todayISO(),
      walletId: "w-instapay",
    });
    assert.equal(updatedOk, true);

    const after = useFinance.getState();
    const syncedPay = after.payments.find((p) => p.id === payId)!;
    const syncedTx = after.txns.find((t) => t.id === payment.txId)!;
    assert.equal(syncedPay.amount, 350);
    assert.equal(syncedPay.walletId, "w-instapay");
    assert.equal(syncedTx.amount, 350);
    assert.equal(syncedTx.reported, false);
    assert.equal(remaining(after.debts.find((d) => d.id === debtId)!, after.payments), 150);

    const overEdit = useFinance.getState().updateTxn(payment.txId!, {
      kind: "expense",
      amount: 600,
      categoryId: "c-debt-out",
      note: "زيادة مرفوضة",
      date: todayISO(),
      walletId: "w-cash",
    });
    assert.equal(overEdit, false);
    assert.equal(useFinance.getState().payments.find((p) => p.id === payId)!.amount, 350);
  });

  it("restores linked tx.personId values when undoing removePerson", () => {
    const s = useFinance.getState();
    const personId = s.addPerson({ name: "مريم", phone: "", note: "" });
    const txId = s.addTxn({
      kind: "expense",
      amount: 120,
      categoryId: "c-food",
      note: "غداء",
      date: todayISO(),
      personId,
      walletId: "w-cash",
    });

    const snap = useFinance.getState().removePerson(personId);
    assert.ok(snap);
    assert.deepEqual(snap.linkedTxIds, [txId]);
    assert.equal(useFinance.getState().txns.find((t) => t.id === txId)?.personId, undefined);

    useFinance.getState().restorePerson(snap.person, snap.linkedTxIds);
    assert.equal(useFinance.getState().txns.find((t) => t.id === txId)?.personId, personId);
  });

  it("prevents deleting custom category used in recurring items", () => {
    const s = useFinance.getState();
    const catId = s.addCategory("اشتراك خاص", "expense")!;
    assert.ok(catId);
    s.addRecurring({
      kind: "expense",
      amount: 99,
      categoryId: catId,
      walletId: "w-cash",
      note: "اشتراك",
      day: 5,
      active: true,
    });
    assert.equal(useFinance.getState().removeCategory(catId), false);
  });

  it("confirms recurring once per currentMonth and returns null if already confirmed", () => {
    const s = useFinance.getState();
    const recId = s.addRecurring({
      kind: "expense",
      amount: 250,
      categoryId: "c-bills",
      walletId: "w-cash",
      note: "إنترنت",
      day: 1,
      active: true,
    });
    const first = useFinance.getState().confirmRecurring(recId);
    assert.ok(first);
    const second = useFinance.getState().confirmRecurring(recId);
    assert.equal(second, null);
  });

  it("clears PIN and scheduled tasks on resetAll only when requested", () => {
    localStorage.setItem("mizan.pin", "abc123");
    localStorage.setItem("mizan.scheduled-tasks.v1", JSON.stringify([{ id: "t1" }]));

    useFinance.getState().resetAll();
    assert.equal(localStorage.getItem("mizan.pin"), "abc123");
    assert.ok(localStorage.getItem("mizan.scheduled-tasks.v1"));

    useFinance.getState().resetAll({ clearSecurityAndTasks: true });
    assert.equal(localStorage.getItem("mizan.pin"), null);
    assert.equal(localStorage.getItem("mizan.scheduled-tasks.v1"), null);
  });

  it("sanitizes phoneCountryCode and tracks remote updatedAt on replaceAll", () => {
    useFinance.getState().setPhoneCountryCode("+966");
    assert.equal(useFinance.getState().phoneCountryCode, "966");
    const snapshot = pickFinanceData(useFinance.getState());
    const parsed = asData(snapshot);
    assert.equal(parsed?.phoneCountryCode, "966");

    setLocalUpdatedAt(500);
    useFinance.getState().replaceAll(seedData(), 999999);
    assert.equal(getLocalUpdatedAt(), 999999);
  });
});
