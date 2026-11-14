export type TaskRepeat = "once" | "daily" | "weekly" | "monthly";

export type ScheduledTask = {
  id: string;
  title: string;
  body: string;
  dueAt: string;
  repeat: TaskRepeat;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type TaskInput = Pick<ScheduledTask, "title" | "body" | "dueAt" | "repeat">;

const KEY = "mizan.scheduled-tasks.v1";

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
    typeof task.updatedAt === "number"
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
  const task: ScheduledTask = { id: uid(), title, body: input.body.trim(), dueAt: dueAt.toISOString(), repeat: input.repeat, enabled: true, createdAt: now, updatedAt: now };
  persist([...loadScheduledTasks(storage), task], storage);
  return task;
}

export function updateScheduledTask(id: string, input: TaskInput, storage: Storage = localStorage): ScheduledTask {
  const tasks = loadScheduledTasks(storage);
  const current = tasks.find((task) => task.id === id);
  if (!current) throw new Error("Task not found");
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new Error("Task date is invalid");
  const updated: ScheduledTask = { ...current, title: input.title.trim(), body: input.body.trim(), dueAt: dueAt.toISOString(), repeat: input.repeat, updatedAt: Date.now() };
  persist(tasks.map((task) => (task.id === id ? updated : task)), storage);
  return updated;
}

export function setScheduledTaskEnabled(id: string, enabled: boolean, storage: Storage = localStorage) {
  const tasks = loadScheduledTasks(storage);
  persist(tasks.map((task) => (task.id === id ? { ...task, enabled, updatedAt: Date.now() } : task)), storage);
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

export { KEY as SCHEDULED_TASKS_STORAGE_KEY };
