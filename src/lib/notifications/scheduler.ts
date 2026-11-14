import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  loadScheduledTasks,
  nextOccurrence,
  taskNotificationId,
  type ScheduledTask,
} from "./tasks";

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";

const webTimers = new Map<string, number>();

function isNative() {
  return Capacitor.isNativePlatform();
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isNative()) {
    const result = await LocalNotifications.requestPermissions();
    return result.display === "granted" ? "granted" : "denied";
  }
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") return (await Notification.requestPermission()) as NotificationPermission;
  return Notification.permission as NotificationPermission;
}

export async function notificationPermission(): Promise<NotificationPermission> {
  if (isNative()) {
    const result = await LocalNotifications.checkPermissions();
    return result.display === "granted" ? "granted" : result.display === "denied" ? "denied" : "prompt";
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotificationPermission;
}

export async function cancelTaskNotification(taskId: string) {
  if (isNative()) {
    await LocalNotifications.cancel({ notifications: [{ id: taskNotificationId(taskId) }] });
  }
  const timer = webTimers.get(taskId);
  if (timer) window.clearTimeout(timer);
  webTimers.delete(taskId);
}

export async function scheduleTaskNotification(task: ScheduledTask): Promise<boolean> {
  await cancelTaskNotification(task.id);
  if (!task.enabled) return false;
  const at = nextOccurrence(task);
  if (!at) return false;
  const permission = await notificationPermission();
  if (permission !== "granted") return false;

  if (isNative()) {
    await LocalNotifications.schedule({
      notifications: [{
        id: taskNotificationId(task.id),
        title: task.title,
        body: task.body || "لديك مهمة مجدولة في ميزان",
        schedule: { at, allowWhileIdle: true },
        extra: { taskId: task.id },
      }],
    });
    return true;
  }

  const delay = at.getTime() - Date.now();
  if (delay <= 0 || delay > 2_147_000_000) return false;
  const timer = window.setTimeout(() => {
    new Notification(task.title, { body: task.body || "لديك مهمة مجدولة في ميزان", tag: task.id });
    webTimers.delete(task.id);
    if (task.repeat !== "once") void scheduleTaskNotification(task);
  }, delay);
  webTimers.set(task.id, timer);
  return true;
}

export async function cancelAllTaskNotifications() {
  const tasks = loadScheduledTasks();
  await Promise.all(tasks.map((task) => cancelTaskNotification(task.id)));
}

export async function scheduleAllTaskNotifications() {
  const tasks = loadScheduledTasks().filter((task) => task.enabled);
  await Promise.all(tasks.map((task) => scheduleTaskNotification(task)));
  return tasks.length;
}
