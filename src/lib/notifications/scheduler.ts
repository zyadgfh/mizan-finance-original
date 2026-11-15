import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { LocalNotifications, type ActionPerformed } from "@capacitor/local-notifications";
import {
  ACTION_MARK_PAID,
  ACTION_SNOOZE_DAY,
  MIZAN_PAYMENT_ACTION_TYPE,
  loadScheduledTasks,
  nextOccurrence,
  supportsMarkPaidAction,
  taskNotificationId,
  type ScheduledTask,
} from "./tasks";

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";
export const MIZAN_CHANNEL_ID = "mizan-reminders";

const webTimers = new Map<string, number>();
let actionsPrepared = false;

function isNative() {
  return Capacitor.isNativePlatform();
}

export async function ensureNativeNotificationSetup(): Promise<void> {
  if (!isNative() || actionsPrepared) return;
  actionsPrepared = true;
  try {
    await LocalNotifications.createChannel({
      id: MIZAN_CHANNEL_ID,
      name: "تذكيرات ميزان",
      description: "تذكيرات الديون والفواتير المتكررة والميزانيات",
      importance: 4,
      vibration: true,
    });
  } catch {
    /* channel already exists or iOS */
  }
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: MIZAN_PAYMENT_ACTION_TYPE,
          actions: [
            { id: ACTION_MARK_PAID, title: "تم الدفع", foreground: true },
            { id: ACTION_SNOOZE_DAY, title: "تأجيل يوم", foreground: false },
          ],
        },
      ],
    });
  } catch {
    /* ignore unsupported platform */
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isNative()) {
    await ensureNativeNotificationSetup();
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
    await ensureNativeNotificationSetup();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: taskNotificationId(task.id),
          title: task.title,
          body: task.body || "لديك مهمة مجدولة في ميزان",
          channelId: MIZAN_CHANNEL_ID,
          actionTypeId: supportsMarkPaidAction(task) ? MIZAN_PAYMENT_ACTION_TYPE : undefined,
          schedule: { at, allowWhileIdle: true },
          extra: {
            taskId: task.id,
            category: task.category ?? "manual",
            relatedId: task.relatedId ?? "",
            amount: task.amount ?? 0,
          },
        },
      ],
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

export async function scheduleTestNotificationInSeconds(seconds = 10): Promise<boolean> {
  const perm = await notificationPermission();
  if (perm !== "granted") return false;
  const at = new Date(Date.now() + seconds * 1000);
  if (isNative()) {
    await ensureNativeNotificationSetup();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 990001,
          title: "اختبار تنبيهات ميزان",
          body: "التنبيه يعمل حتى بعد إغلاق التطبيق أو إعادة التشغيل.",
          channelId: MIZAN_CHANNEL_ID,
          actionTypeId: MIZAN_PAYMENT_ACTION_TYPE,
          schedule: { at, allowWhileIdle: true },
          extra: { taskId: "test-probe" },
        },
      ],
    });
    return true;
  }
  window.setTimeout(() => {
    new Notification("اختبار تنبيهات ميزان", {
      body: "التنبيه يعمل بنجاح على هذا المتصفح.",
      tag: "mizan-test-probe",
    });
  }, seconds * 1000);
  return true;
}

export type NotificationDiagnostics = {
  platform: "native" | "web";
  permission: NotificationPermission;
  exactAlarm: "granted" | "denied" | "prompt" | "web";
  nativePendingCount: number;
};

export async function checkNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  const permission = await notificationPermission();
  if (!isNative()) {
    return {
      platform: "web",
      permission,
      exactAlarm: "web",
      nativePendingCount: webTimers.size,
    };
  }
  let exactAlarm: NotificationDiagnostics["exactAlarm"] = "prompt";
  try {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    exactAlarm = exact.exact_alarm === "granted" ? "granted" : exact.exact_alarm === "denied" ? "denied" : "prompt";
  } catch {
    exactAlarm = "granted";
  }
  let nativePendingCount = 0;
  try {
    const pending = await LocalNotifications.getPending();
    nativePendingCount = pending.notifications.length;
  } catch {
    nativePendingCount = 0;
  }
  return {
    platform: "native",
    permission,
    exactAlarm,
    nativePendingCount,
  };
}

export async function openAndroidExactAlarmSettings(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch {
    /* ignore */
  }
}

export async function registerNotificationActionListener(
  onAction: (action: ActionPerformed) => void,
): Promise<() => void> {
  if (!isNative()) return () => undefined;
  await ensureNativeNotificationSetup();
  let handle: PluginListenerHandle | undefined;
  try {
    handle = await LocalNotifications.addListener("localNotificationActionPerformed", onAction);
  } catch {
    return () => undefined;
  }
  return () => {
    void handle?.remove();
  };
}
