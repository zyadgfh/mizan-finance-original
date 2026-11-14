import { Bell, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Group, PillButton, Row, Section, Segment } from "@/components/finance/ui";
import {
  addScheduledTask,
  loadScheduledTasks,
  removeScheduledTask,
  setScheduledTaskEnabled,
  type ScheduledTask,
  type TaskRepeat,
} from "@/lib/notifications/tasks";
import {
  notificationPermission,
  requestNotificationPermission,
  scheduleTaskNotification,
  cancelTaskNotification,
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
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState(localDateTimeValue);
  const [repeat, setRepeat] = useState<TaskRepeat>("once");
  const [permission, setPermission] = useState("prompt");

  const refresh = () => setTasks(loadScheduledTasks());
  useEffect(() => {
    refresh();
    void notificationPermission().then(setPermission);
  }, []);

  const enabledCount = useMemo(() => tasks.filter((task) => task.enabled).length, [tasks]);

  async function enableNotifications() {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") toast("تم تفعيل الإشعارات");
    else toast("لم يتم منح إذن الإشعارات");
  }

  async function addTask() {
    try {
      const task = addScheduledTask({ title, body, dueAt, repeat });
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

  return (
    <div>
      <div className="px-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-tint text-on-tint"><Bell size={22} /></span>
          <div>
            <h1 className="text-largetitle font-bold tracking-title">الإشعارات والمهام</h1>
            <p className="mt-1 text-sub text-label-2">{enabledCount} مهمة مفعّلة على هذا الجهاز.</p>
          </div>
        </div>
      </div>
      {permission !== "granted" ? (
        <Section title="إذن الإشعارات" footer="لن يرسل ميزان إشعارات دون موافقتك.">
          <div className="mx-4 rounded-cell bg-cell px-4 py-3">
            <p className="text-body">فعّل الإشعارات لتذكيرك بالديون والفواتير والمهام.</p>
            <div className="mt-3"><PillButton onClick={() => void enableNotifications()}>تفعيل الإشعارات</PillButton></div>
          </div>
        </Section>
      ) : null}
      <Section title="مهمة جديدة">
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4"><span className="text-body">العنوان</span><input className="field flex-1 text-end" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: سداد الإيجار" /></label>
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4"><span className="text-body">التفاصيل</span><input className="field flex-1 text-end" value={body} onChange={(e) => setBody(e.target.value)} placeholder="اختياري" /></label>
          <label className="flex min-h-12 items-center gap-3 border-b border-separator px-4"><span className="text-body">الموعد</span><input className="field flex-1 text-end" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
          <div className="px-3 py-3"><Segment value={repeat} onChange={setRepeat} options={repeatOptions} /></div>
        </div>
        <div className="mt-3 px-4"><PillButton onClick={() => void addTask()} disabled={!title.trim()}>جدولة المهمة</PillButton></div>
      </Section>
      <Section title="المهام المجدولة">
        {tasks.length === 0 ? <p className="px-8 text-sub text-label-2">لا توجد مهام بعد.</p> : <Group>{tasks.map((task) => <Row key={task.id} title={task.title} sub={`${formatDate(task.dueAt)} · ${repeatOptions.find((option) => option.id === task.repeat)?.label}${task.body ? ` · ${task.body}` : ""}`} onClick={() => void toggle(task)} trailing={<button type="button" aria-label={`حذف ${task.title}`} className="p-2 text-expense" onClick={(event) => { event.stopPropagation(); void remove(task); }}><Trash2 size={18} /></button>} />)}</Group>}
      </Section>
    </div>
  );
}
