import assert from "node:assert/strict";
import test from "node:test";
import { seedData } from "./seed.ts";
import { parseSmartFinancialInput } from "./smart-capture.ts";
import { computeNetWorthZakat } from "./zakat.ts";
import { computePersonDebtStatement, encodeJpegPagesIntoPdf } from "./person-statement-pdf.ts";

test("parseSmartFinancialInput parses InstaPay, Vodafone Cash, Bank Card SMS, and colloquial Arabic transfers offline", () => {
  const base = seedData();
  const data = {
    ...base,
    wallets: [
      { id: "w-cash", name: "كاش", kind: "cash" as const, opening: 1000, createdAt: 1 },
      { id: "w-insta", name: "إنستا باي", kind: "instapay" as const, opening: 5000, createdAt: 2 },
      { id: "w-voda", name: "فودافون كاش", kind: "vodafone" as const, opening: 2000, createdAt: 3 },
      { id: "w-cib", name: "بطاقة البنك", kind: "card" as const, opening: 8000, last4: "4821", createdAt: 4 },
      { id: "w-bank", name: "البنك الأهلي", kind: "bank" as const, opening: 20000, createdAt: 5 },
    ],
    people: [
      { id: "p-ahmed", name: "أحمد طارق", phone: "01012345678", note: "", createdAt: 1 },
    ],
    txns: [],
  };

  // 1. InstaPay incoming transfer
  const instaIn = parseSmartFinancialInput(
    "تم استلام تحويل بمبلغ 3,250.50 ج.م على حسابك عبر InstaPay من أحمد طارق بنجاح",
    data,
  );
  assert.equal(instaIn.kind, "income");
  assert.equal(instaIn.amount, 3250.5);
  assert.equal(instaIn.walletId, "w-insta");
  assert.equal(instaIn.personId, "p-ahmed");

  // 2. Vodafone Cash outgoing SMS (ignores service fee & phone digits when extracting amount)
  const vfOut = parseSmartFinancialInput(
    "تم تحويل 650 جنيه لرقم 01012345678 مصاريف الخدمة 1 جنيه من محفظة فودافون كاش بتاريخ 20/11/2026",
    data,
  );
  assert.equal(vfOut.kind, "expense");
  assert.equal(vfOut.amount, 650);
  assert.equal(vfOut.walletId, "w-voda");
  assert.equal(vfOut.personId, "p-ahmed");

  // 3. Bank card purchase SMS with last4 digits + merchant category
  const cardSms = parseSmartFinancialInput(
    "تم خصم مبلغ EGP 875.25 من بطاقتك المنتهية بـ 4821 لدى CARREFOUR بتاريخ 20/11/2026 الساعة 19:40",
    data,
  );
  assert.equal(cardSms.kind, "expense");
  assert.equal(cardSms.amount, 875.25);
  assert.equal(cardSms.walletId, "w-cib");
  assert.equal(cardSms.categoryId, "c-food");

  // 4. Colloquial Arabic quick expense with Eastern Arabic numerals
  const quickArabic = parseSmartFinancialInput("دفعت ٢٥٠ كافيه من كاش", data);
  assert.equal(quickArabic.kind, "expense");
  assert.equal(quickArabic.amount, 250);
  assert.equal(quickArabic.walletId, "w-cash");
  assert.equal(quickArabic.categoryId, "c-food");
  assert.equal(quickArabic.note, "كافيه");

  // 5. Wallet-to-wallet transfer command
  const transferCmd = parseSmartFinancialInput("حولت 1500 من البنك الأهلي إلى فودافون كاش", data);
  assert.equal(transferCmd.kind, "transfer");
  assert.equal(transferCmd.amount, 1500);
  assert.equal(transferCmd.walletId, "w-bank");
  assert.equal(transferCmd.toWalletId, "w-voda");
});

test("computeNetWorthZakat includes wallets + savings goals + receivable debts minus full payable debts", () => {
  const base = seedData();
  const data = {
    ...base,
    currency: "EGP" as const,
    wallets: [
      { id: "w-1", name: "البنك", kind: "bank" as const, opening: 350000, createdAt: 1 },
    ],
    txns: [],
    transfers: [],
    // Moving 50,000 into a goal reduces walletBalance by 50,000, so total liquid + goals must remain 350,000!
    goalMoves: [
      { id: "gm-1", goalId: "g-1", walletId: "w-1", amount: 50000, date: "2026-11-01", note: "", createdAt: 1 },
    ],
    debts: [
      {
        id: "d-rec",
        personId: "p-1",
        direction: "receivable" as const,
        title: "سلفة مستحقة لي",
        principal: 100000,
        dueDate: "2026-12-01",
        note: "",
        createdAt: 1,
      },
      {
        id: "d-pay",
        personId: "p-2",
        direction: "payable" as const,
        title: "التزام عليّ",
        principal: 50000,
        dueDate: "2026-12-01",
        note: "",
        createdAt: 2,
      },
    ],
    payments: [],
  };

  // Net worth = 300,000 (wallet) + 50,000 (goal) + 100,000 (receivable) - 50,000 (payable) = 400,000 EGP
  // Nisab = 85g * 4,000 EGP = 340,000 EGP -> Reaches Nisab! Zakat = 400,000 * 2.5% = 10,000 EGP
  const above = computeNetWorthZakat(data, 4000);
  assert.equal(above.walletsLiquidTotal, 300000);
  assert.equal(above.goalsSavedTotal, 50000);
  assert.equal(above.netZakatableWealth, 400000);
  assert.equal(above.nisabAmount, 340000);
  assert.equal(above.reachesNisab, true);
  assert.equal(above.zakatDue, 10000);

  // If gold is 5,000 EGP/g -> Nisab = 425,000 EGP -> Below Nisab by 25,000 EGP, Zakat = 0
  const below = computeNetWorthZakat(data, 5000);
  assert.equal(below.reachesNisab, false);
  assert.equal(below.shortfallToNisab, 25000);
  assert.equal(below.zakatDue, 0);
});

test("computePersonDebtStatement and encodeJpegPagesIntoPdf build valid multi-page ISO PDF-1.4 document", () => {
  const data = {
    currency: "EGP" as const,
    people: [{ id: "p-1", name: "خالد محمود", phone: "01122334455", note: "عميل توريدات", createdAt: 1 }],
    debts: [
      {
        id: "d-1",
        personId: "p-1",
        direction: "receivable" as const,
        title: "بضاعة نوفمبر",
        principal: 12000,
        dueDate: "2026-11-30",
        note: "",
        createdAt: 10,
      },
      {
        id: "d-2",
        personId: "p-1",
        direction: "payable" as const,
        title: "دفعة مرتجع",
        principal: 2000,
        dueDate: "2026-11-25",
        note: "",
        createdAt: 20,
      },
    ],
    payments: [
      { id: "pay-1", debtId: "d-1", amount: 4500, date: "2026-11-18", note: "إنستا باي", createdAt: 30 },
    ],
  };

  const stmt = computePersonDebtStatement(data, "p-1", "شركة النور", "2026-11-20");
  assert.ok(stmt);
  assert.equal(stmt.summary.receivableRemaining, 7500);
  assert.equal(stmt.summary.payableRemaining, 2000);
  assert.equal(stmt.summary.netBalance, 5500);
  assert.equal(stmt.payments.length, 1);

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdfBytes = encodeJpegPagesIntoPdf([
    { widthPx: 1240, heightPx: 1754, jpegBytes: fakeJpeg },
    { widthPx: 1240, heightPx: 1754, jpegBytes: fakeJpeg },
  ]);
  const text = new TextDecoder("latin1").decode(pdfBytes);
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.includes("/Type /Pages /Count 2"));
  assert.ok(text.includes("/Filter /DCTDecode"));
  assert.ok(text.includes("xref\n0 9\n"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});
