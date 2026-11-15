import { AlarmClock, Bell, BellRing, Check, Clock, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Group, PillButton, Row, Section, Segment } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { pickFinanceData, useFinance } from "@/lib/finance/store";
import {
  ACTION_MARK_PAID,
  ACTION_SNOOZE_DAY,
  addScheduledTask,
  buildSmartTaskSuggestions,
  executeNotificationAction,
  loadScheduledTasks,
  removeScheduledTask,
  setScheduledTaskEnabled,
  supportsMarkPaidAction,
  type ScheduledTask,
  type SmartTaskSuggestion,
  type TaskRepeat,
} from "@/lib/notifications/tasks";
import {
  cancelTaskNotification,
  checkNotificationDiagnostics,
  notificationPermission,
  openAndroidExactAlarmSettings,
  requestNotificationPermission,
  scheduleAllTaskNotifications,
  scheduleTaskNotification,
  scheduleTestNotificationInSeconds,
  type NotificationDiagnostics,
} from "@/lib/notifications/scheduler";

const repeatOptions: { id: TaskRepeat; label: string }[] = [
  { id: "once", label: "مرة واحدة" },
  { id: "daily", label: "يومياً" },
  { id: "weekly", label: "أسبوعياً" },
  { id: "monthly", label: "شهرياً" },
];

function localDateTimeValue(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function NotificationsScreen() {
  const data = useFinance();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState(localDateTimeValue);
  const [repeat, setRepeat] = useState<TaskRepeat>("once");
  const [permission, setPermission] = useState("prompt");
  const [diag, setDiag] = useState<NotificationDiagnostics | null>(null);

  const refresh = () => {
    setTasks(loadScheduledTasks());
    void checkNotificationDiagnostics().then(setDiag);
  };

  useEffect(() => {
    refresh();
    void notificationPermission().then(setPermission);
  }, []);

  const enabledCount = useMemo(() => tasks.filter((task) => task.enabled).length, [tasks]);
  const suggestions = useMemo(() => {
    const existingKeys = new Set(tasks.map((t) => `${t.category ?? "manual"}:${t.relatedId ?? t.title}`));
    return buildSmartTaskSuggestions(pickFinanceData(data)).filter((s) => !existingKeys.has(s.key));
  }, [data, tasks]);

  async function enableNotifications() {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") {
      await scheduleAllTaskNotifications();
      refresh();
      toast("تم تفعيل الإشعارات");
    } else {
      toast("لم يتم منح إذن الإشعارات");
    }
  }

  async function addTask() {
    try {
      const task = addScheduledTask({ title, body, dueAt, repeat, category: "manual" });
      const scheduled = await scheduleTaskNotification(task);
      setTitle("");
      setBody("");
      setDueAt(localDateTimeValue());
      setRepeat("once");
      refresh();
      toast(scheduled ? "تمت جدولة المهمة" : "حُفظت المهمة؛ فعّل إذن الإشعارات لتلقي التنبيه");
    } catch (error) {
      toast(error instanceof Error ? error.message : "تعذر حفظ المهمة");
    }
  }

  async function addSuggestion(s: SmartTaskSuggestion) {
    try {
      const task = addScheduledTask({
        title: s.title,
        body: s.body,
        dueAt: s.dueAt,
        repeat: s.repeat,
        category: s.category,
        relatedId: s.relatedId,
        amount: s.amount,
      });
      const scheduled = await scheduleTaskNotification(task);
      refresh();
      toast(scheduled ? `جُدول تذكير «${s.title}»` : `حُفظ تذكير «${s.title}»`);
    } catch {
      toast("تعذرت جدولة الاقتراح");
    }
  }

  async function runAction(task: ScheduledTask, actionId: string) {
    const res = executeNotificationAction(actionId, task, {
      getData: () => pickFinanceData(useFinance.getState()),
      addPayment: data.addPayment,
      confirmRecurring: data.confirmRecurring,
      addTxn: data.addTxn,
    });
    if (actionId === ACTION_SNOOZE_DAY && res.updatedTask) {
      await scheduleTaskNotification(res.updatedTask);
    } else if (actionId === ACTION_MARK_PAID) {
      await cancelTaskNotification(task.id);
    }
    refresh();
    if (res.message) toast(res.message);
  }

  async function toggle(task: ScheduledTask) {
    setScheduledTaskEnabled(task.id, !task.enabled);
    if (task.enabled) await cancelTaskNotification(task.id);
    else await scheduleTaskNotification({ ...task, enabled: true });
    refresh();
  }

  async function remove(task: ScheduledTask) {
    await cancelTaskNotification(task.id);
    removeScheduledTask(task.id);
    refresh();
    toast("تم حذف المهمة");
  }

  async function sendTestProbe() {
    const ok = await scheduleTestNotificationInSeconds(5);
    toast(ok ? "سيصلك إشعار تجريبي خلال 5 ثوانٍ" : "فعّل إذن الإشعارات أولاً");
  }

  return (
    <div>
      <div data-stagger className="px-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-tint text-on-tint">
            <Bell size={22} />
          </span>
          <div>
            <h1 className="text-largetitle font-bold tracking-title">الإشعارات والمهام</h1>
            <p className="mt-1 text-sub text-label-2">{enabledCount} مهمة مفعّلة على هذا الجهاز.</p>
          </div>
        </div>
      </div>

      {permission !== "granted" ? (
        <Section title="إذن الإشعارات" footer="لن يرسل ميزان إشعارات دون موافقتك.">
          <div className="surface-card mx-4 rounded-cell px-4 py-3">
            <p className="text-body">فعّل الإشعارات لتذكيرك بالديون والفواتير والمهام حتى عند إغلاق التطبيق.</p>
            <div className="mt-3">
              <PillButton onClick={() => void enableNotifications()}>تفعيل الإشعارات</PillButton>
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="تشخيص الإشعارات"
        footer={
          diag?.platform === "native"
            ? "على Android 12+ تأكد من السماح بالتنبيهات الدقيقة لتصل في موعدها أثناء وضع السكون."
            : "على الويب تعمل الإشعارات أثناء فتح الجلسة؛ وفي تطبيق Android تصل في الخلفية وبعد إعادة التشغيل."
        }
      >
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: permission === "granted" ? "var(--green)" : "var(--orange)" }}>
                <BellRing size={16} />
              </span>
            }
            title={permission === "granted" ? "الإذن ممنوح" : "يتطلب منح الإذن"}
            sub={
              diag
                ? `${diag.platform === "native" ? "تطبيق Android الأصلي" : "متصفح الويب"} · ${diag.nativePendingCount} إشعار معلّق في النظام`
                : "جارٍ الفحص…"
            }
            trailing={
              <PillButton tone="gray" onClick={() => void sendTestProbe()}>
                اختبار (5 ث)
              </PillButton>
            }
          />
          {diag?.platform === "native" && diag.exactAlarm !== "granted" ? (
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--orange)" }}>
                  <AlarmClock size={16} />
                </span>
              }
              title="التنبيهات الدقيقة (Exact Alarms)"
              sub="مطلوبة لعدم تأخير الإشعار في Doze Mode"
              chevron
              onClick={() => void openAndroidExactAlarmSettings()}
            />
          ) : null}
        </Group>
      </Section>

      {suggestions.length ? (
        <Section title="تذكيرات ذكية مقترحة" footer="مشتقة محلياً من ديونك القريبة والحركات المتكررة والميزانيات.">
          <Group sep="icon">
            {suggestions.map((s) => (
              <Row
                key={s.key}
                leading={
                  <span className="icon-tile" style={{ background: "var(--tint)" }}>
                    <Sparkles size={16} />
                  </span>
                }
                title={s.title}
                sub={`${formatDate(s.dueAt)} · ${s.body}`}
                trailing={
                  <PillButton tone="gray" onClick={() => void addSuggestion(s)}>
                    جدولة
                  </PillButton>
                }
              />
            ))}
          </Group>
        </Section>
      ) : null}

      <Section title="مهمة جديدة">
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4">
            <span className="text-body">العنوان</span>
            <input
              className="field flex-1 text-end"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: سداد الإيجار"
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4">
            <span className="text-body">التفاصيل</span>
            <input
              className="field flex-1 text-end"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="اختياري"
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4">
            <span className="text-body">الموعد</span>
            <input
              className="field flex-1 text-end"
              dir="ltr"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <div className="px-3 py-3">
            <Segment value={repeat} onChange={setRepeat} options={repeatOptions} />
          </div>
        </div>
        <div className="mt-3 px-4">
          <PillButton onClick={() => void addTask()} disabled={!title.trim()}>
            جدولة المهمة
          </PillButton>
        </div>
      </Section>

      <Section title="المهام المجدولة">
        {tasks.length === 0 ? (
          <p className="px-8 text-sub text-label-2">لا توجد مهام بعد.</p>
        ) : (
          <Group>
            {tasks.map((task) => {
              const repeatLabel = repeatOptions.find((option) => option.id === task.repeat)?.label ?? "";
              const canMarkPaid = supportsMarkPaidAction(task);
              return (
                <div
                  key={task.id}
                  className={cn("px-4 py-3", !task.enabled && "opacity-60")}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-start">
                      <span className="block truncate text-body font-medium">{task.title}</span>
                      <span className="block truncate text-foot text-label-2">
                        {formatDate(task.dueAt)} · {repeatLabel}
                        {!task.enabled ? " · متوقفة" : ""}
                        {task.body ? ` · ${task.body}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={task.enabled}
                      aria-label={`${task.enabled ? "إيقاف" : "تفعيل"} ${task.title}`}
                      onClick={() => void toggle(task)}
                      className={cn("h-7 w-12 shrink-0 rounded-pill p-0.5", task.enabled ? "bg-tint" : "bg-fill")}
                    >
                      <span className={cn("block h-6 w-6 rounded-pill bg-cell", task.enabled && "ms-auto")} />
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف ${task.title}`}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-inner text-expense"
                      onClick={() => void remove(task)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  {task.enabled ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canMarkPaid ? (
                        <button
                          type="button"
                          onClick={() => void runAction(task, ACTION_MARK_PAID)}
                          className="inline-flex items-center gap-1 rounded-pill bg-income/15 px-3 py-1 text-caption font-semibold text-income"
                        >
                          <Check size={13} />
                          <span>تم الدفع</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void runAction(task, ACTION_SNOOZE_DAY)}
                        className="inline-flex items-center gap-1 rounded-pill bg-fill px-3 py-1 text-caption font-semibold text-label-2"
                      >
                        <Clock size={13} />
                        <span>تأجيل يوم</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Group>
        )}
      </Section>
    </div>
  );
}
