import {
  addDaysISO,
  budgetAlerts,
  currentMonth,
  nextDueDate,
  pendingRecurring,
  remaining,
  todayISO,
  weeklySpendingSummary,
} from "../finance/logic.ts";
import type { Data } from "../finance/types.ts";

export type TaskRepeat = "once" | "daily" | "weekly" | "monthly";
export type TaskCategory = "manual" | "debt" | "recurring" | "incomplete" | "budget" | "weekly";

export type ScheduledTask = {
  id: string;
  title: string;
  body: string;
  dueAt: string;
  repeat: TaskRepeat;
  enabled: boolean;
  category?: TaskCategory;
  relatedId?: string;
  amount?: number;
  createdAt: number;
  updatedAt: number;
};

export type TaskInput = Pick<ScheduledTask, "title" | "body" | "dueAt" | "repeat"> & {
  category?: TaskCategory;
  relatedId?: string;
  amount?: number;
};

export const ACTION_MARK_PAID = "mark-paid";
export const ACTION_SNOOZE_DAY = "snooze-day";
export const MIZAN_PAYMENT_ACTION_TYPE = "MIZAN_PAYMENT_TASK";

const KEY = "mizan.scheduled-tasks.v1";
const VALID_CATEGORIES = new Set<string>(["manual", "debt", "recurring", "incomplete", "budget", "weekly"]);

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function isTask(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ScheduledTask>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.body === "string" &&
    typeof task.dueAt === "string" &&
    ["once", "daily", "weekly", "monthly"].includes(task.repeat ?? "") &&
    typeof task.enabled === "boolean" &&
    typeof task.createdAt === "number" &&
    typeof task.updatedAt === "number" &&
    (task.category === undefined || VALID_CATEGORIES.has(task.category))
  );
}

export function loadScheduledTasks(storage: Storage = localStorage): ScheduledTask[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTask).sort((a, b) => a.dueAt.localeCompare(b.dueAt)) : [];
  } catch {
    return [];
  }
}

function persist(tasks: ScheduledTask[], storage: Storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(tasks));
}

export function addScheduledTask(input: TaskInput, storage: Storage = localStorage): ScheduledTask {
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required");
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new Error("Task date is invalid");
  if (dueAt.getTime() <= Date.now() && input.repeat === "once") throw new Error("Task date must be in the future");
  const now = Date.now();
  const task: ScheduledTask = {
    id: uid(),
    title,
    body: input.body.trim(),
    dueAt: dueAt.toISOString(),
    repeat: input.repeat,
    enabled: true,
    category: input.category ?? "manual",
    relatedId: input.relatedId,
    amount: typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0 ? input.amount : undefined,
    createdAt: now,
    updatedAt: now,
  };
  persist([...loadScheduledTasks(storage), task], storage);
  return task;
}

export function updateScheduledTask(id: string, input: TaskInput, storage: Storage = localStorage): ScheduledTask {
  const tasks = loadScheduledTasks(storage);
  const current = tasks.find((task) => task.id === id);
  if (!current) throw new Error("Task not found");
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new Error("Task date is invalid");
  const updated: ScheduledTask = {
    ...current,
    title: input.title.trim(),
    body: input.body.trim(),
    dueAt: dueAt.toISOString(),
    repeat: input.repeat,
    category: input.category ?? current.category,
    relatedId: input.relatedId !== undefined ? input.relatedId : current.relatedId,
    amount: input.amount !== undefined ? input.amount : current.amount,
    updatedAt: Date.now(),
  };
  persist(tasks.map((task) => (task.id === id ? updated : task)), storage);
  return updated;
}

export function setScheduledTaskEnabled(id: string, enabled: boolean, storage: Storage = localStorage) {
  const tasks = loadScheduledTasks(storage);
  persist(tasks.map((task) => (task.id === id ? { ...task, enabled, updatedAt: Date.now() } : task)), storage);
}

export function snoozeScheduledTaskByDays(id: string, days = 1, storage: Storage = localStorage): ScheduledTask | null {
  const tasks = loadScheduledTasks(storage);
  const current = tasks.find((t) => t.id === id);
  if (!current) return null;
  const base = Math.max(Date.now(), new Date(current.dueAt).getTime());
  const nextDue = new Date(base + days * 86_400_000).toISOString();
  const updated: ScheduledTask = { ...current, dueAt: nextDue, enabled: true, updatedAt: Date.now() };
  persist(tasks.map((t) => (t.id === id ? updated : t)), storage);
  return updated;
}

export function removeScheduledTask(id: string, storage: Storage = localStorage) {
  persist(loadScheduledTasks(storage).filter((task) => task.id !== id), storage);
}

export function clearScheduledTasks(storage: Storage = localStorage) {
  storage.removeItem(KEY);
}

export function nextOccurrence(task: ScheduledTask, from = new Date()): Date | null {
  const due = new Date(task.dueAt);
  if (task.repeat === "once") return due > from ? due : null;
  while (due <= from) {
    if (task.repeat === "daily") due.setDate(due.getDate() + 1);
    else if (task.repeat === "weekly") due.setDate(due.getDate() + 7);
    else due.setMonth(due.getMonth() + 1);
  }
  return due;
}

export function taskNotificationId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}

export function supportsMarkPaidAction(task: Pick<ScheduledTask, "category" | "relatedId" | "amount">): boolean {
  if (task.category === "debt" || task.category === "recurring") return Boolean(task.relatedId);
  if (task.category === "incomplete") return Boolean(task.relatedId);
  if (task.category === "manual" || !task.category) return true;
  return false;
}

export type SmartTaskSuggestion = {
  key: string;
  category: Exclude<TaskCategory, "manual">;
  title: string;
  body: string;
  dueAt: string;
  repeat: TaskRepeat;
  relatedId?: string;
  amount?: number;
};

function morningIsoForDate(isoDate: string, now = new Date()): string {
  const candidate = new Date(`${isoDate}T09:00:00`);
  if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now.getTime()) {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  return candidate.toISOString();
}

export function buildSmartTaskSuggestions(data: Data, now = new Date()): SmartTaskSuggestion[] {
  const today = todayISO();
  const month = currentMonth();
  const soon = addDaysISO(today, 3);
  const suggestions: SmartTaskSuggestion[] = [];

  // 1. Debts due soon or overdue
  for (const d of data.debts) {
    const rem = remaining(d, data.payments);
    if (rem <= 0) continue;
    const due = nextDueDate(d, data.payments);
    if (!due || due > soon) continue;
    const person = data.people.find((p) => p.id === d.personId)?.name ?? "";
    const preDue = due > today ? addDaysISO(due, -1) : today;
    suggestions.push({
      key: `debt:${d.id}`,
      category: "debt",
      relatedId: d.id,
      amount: rem,
      title: `${d.direction === "receivable" ? "تحصيل" : "سداد"}: ${d.title}`,
      body: `${person ? `${person} · ` : ""}المتبقي ${rem} ${data.currency} · استحقاق ${due}`,
      dueAt: morningIsoForDate(preDue, now),
      repeat: "once",
    });
  }

  // 2. Pending recurring bills
  for (const r of pendingRecurring(data.recurring, month)) {
    const cat = data.categories.find((c) => c.id === r.categoryId)?.name ?? "فاتورة متكررة";
    const dueDay = `${month}-${String(r.day).padStart(2, "0")}`;
    const remindDay = dueDay > today ? addDaysISO(dueDay, -1) : today;
    suggestions.push({
      key: `recurring:${r.id}`,
      category: "recurring",
      relatedId: r.id,
      amount: r.amount,
      title: `فاتورة متكررة: ${r.note || cat}`,
      body: `المبلغ ${r.amount} ${data.currency} · موعد الشهر يوم ${r.day}`,
      dueAt: morningIsoForDate(remindDay, now),
      repeat: "monthly",
    });
  }

  // 3. Incomplete / unsettled split bills or unattached receipts
  const openReceivables = data.debts.filter((d) => d.direction === "receivable" && remaining(d, data.payments) > 0);
  for (const splitTx of data.txns.filter((t) => t.source === "split" && t.reported === false && t.personId).slice(0, 3)) {
    const matchingDebt = openReceivables.find((d) => d.personId === splitTx.personId && remaining(d, data.payments) > 0);
    if (!matchingDebt) continue;
    suggestions.push({
      key: `incomplete:${matchingDebt.id}`,
      category: "incomplete",
      relatedId: matchingDebt.id,
      amount: remaining(matchingDebt, data.payments),
      title: `حصة غير مسددة: ${splitTx.note}`,
      body: `متبقٍ ${remaining(matchingDebt, data.payments)} ${data.currency} من فاتورة مقسّمة`,
      dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      repeat: "once",
    });
  }

  // 4. Category budgets >= 80%
  for (const b of budgetAlerts(data.budgets, data.categories, data.txns, month)) {
    if (b.level === "ok") continue;
    suggestions.push({
      key: `budget:${b.category.id}`,
      category: "budget",
      relatedId: b.category.id,
      amount: b.spent,
      title:
        b.level === "over"
          ? `تجاوز ميزانية ${b.category.name} (${b.pct}%)`
          : `اقتربت من حد ميزانية ${b.category.name} (${b.pct}%)`,
      body: `المنفق ${b.spent} من أصل ${b.limit} ${data.currency}`,
      dueAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      repeat: "once",
    });
  }

  // 5. Weekly spending summary digest
  const weekly = weeklySpendingSummary(data.txns, data.categories, today);
  const nextSunday = new Date(now.getTime() + 7 * 86_400_000);
  nextSunday.setHours(20, 0, 0, 0);
  suggestions.push({
    key: "weekly:summary",
    category: "weekly",
    title: "ملخص الإنفاق الأسبوعي",
    body:
      weekly.count > 0
        ? `أنفقت ${weekly.currentWeekExpense} ${data.currency} هذا الأسبوع${weekly.topCategoryName ? ` (أكثرها: ${weekly.topCategoryName})` : ""}`
        : "راجع مصروفات الأسبوع وسجّل ما فاتك في ميزان",
    dueAt: nextSunday.toISOString(),
    repeat: "weekly",
  });

  return suggestions;
}

export type NotificationActionStore = {
  getData: () => Data;
  addPayment: (input: {
    debtId: string;
    amount: number;
    date: string;
    note: string;
    walletId?: string;
    linkCash: boolean;
  }) => string;
  confirmRecurring: (id: string) => string | null;
  addTxn: (input: {
    kind: "expense" | "income";
    amount: number;
    categoryId: string;
    note: string;
    date: string;
    walletId?: string;
  }) => string;
};

export function executeNotificationAction(
  actionId: string,
  task: ScheduledTask,
  store: NotificationActionStore,
  storage: Storage = localStorage,
): { handled: boolean; message: string; updatedTask?: ScheduledTask | null } {
  if (actionId === ACTION_SNOOZE_DAY) {
    const updatedTask = snoozeScheduledTaskByDays(task.id, 1, storage);
    return { handled: Boolean(updatedTask), message: "تم تأجيل التذكير ليوم غد", updatedTask };
  }

  if (actionId !== ACTION_MARK_PAID) {
    return { handled: false, message: "إجراء غير معروف" };
  }

  const data = store.getData();
  if ((task.category === "debt" || task.category === "incomplete") && task.relatedId) {
    const debt = data.debts.find((d) => d.id === task.relatedId);
    if (!debt) {
      setScheduledTaskEnabled(task.id, false, storage);
      return { handled: false, message: "لم يعد هذا الدين موجوداً" };
    }
    const rem = remaining(debt, data.payments);
    if (rem <= 0) {
      if (task.repeat === "once") setScheduledTaskEnabled(task.id, false, storage);
      return { handled: true, message: "هذا الدين مسدّد بالفعل" };
    }
    const payAmt = task.amount && task.amount > 0 ? Math.min(rem, task.amount) : rem;
    store.addPayment({
      debtId: debt.id,
      amount: payAmt,
      date: todayISO(),
      note: "تم الدفع من الإشعار",
      walletId: data.wallets[0]?.id ?? "w-cash",
      linkCash: true,
    });
    if (task.repeat === "once") setScheduledTaskEnabled(task.id, false, storage);
    return { handled: true, message: `تم تسجيل سداد ${payAmt} لـ «${debt.title}»` };
  }

  if (task.category === "recurring" && task.relatedId) {
    const txId = store.confirmRecurring(task.relatedId);
    if (task.repeat === "once") setScheduledTaskEnabled(task.id, false, storage);
    return {
      handled: Boolean(txId),
      message: txId ? "تم تأكيد وتسجيل الفاتورة المتكررة" : "هذه الفاتورة مسجّلة بالفعل لهذا الشهر",
    };
  }

  if (task.amount && task.amount > 0) {
    const fallbackCat = data.categories.find((c) => c.kind === "expense")?.id ?? "c-other-x";
    store.addTxn({
      kind: "expense",
      amount: task.amount,
      categoryId: fallbackCat,
      note: task.title,
      date: todayISO(),
      walletId: data.wallets[0]?.id ?? "w-cash",
    });
  }
  if (task.repeat === "once") setScheduledTaskEnabled(task.id, false, storage);
  return { handled: true, message: "تم تحديد المهمة كمدفوعة" };
}

export { KEY as SCHEDULED_TASKS_STORAGE_KEY };
