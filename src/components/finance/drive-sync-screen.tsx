import { CheckCircle2, Cloud, CloudOff, KeyRound, RefreshCw, ShieldCheck, Unlink, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Group, PillButton, Row, Section } from "@/components/finance/ui";
import { shortDate } from "@/lib/finance/logic";
import { asData, getLocalUpdatedAt, pickFinanceData, useFinance } from "@/lib/finance/store";
import type { SyncResult } from "@/lib/sync/drive-sync";
import {
  clearCachedGoogleToken,
  getCachedGoogleToken,
  getConfiguredGoogleClientId,
  getEnvGoogleClientId,
  getGoogleDriveSyncController,
  loadDriveSyncPrefs,
  loadGsiClient,
  requestGoogleDriveToken,
  resetGoogleDriveSyncController,
  saveDriveSyncPrefs,
  setCustomGoogleClientId,
} from "@/lib/sync/google-drive-gis";

function formatSyncTime(ts?: number) {
  if (!ts) return "لم تتم بعد";
  const d = new Date(ts);
  const datePart = shortDate(d.toISOString().slice(0, 10));
  const timePart = d.toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

export function DriveSyncScreen() {
  const replaceAll = useFinance((s) => s.replaceAll);
  const envClientId = getEnvGoogleClientId();
  const [clientId, setClientId] = useState(() => getConfiguredGoogleClientId());
  const [prefs, setPrefs] = useState(() => loadDriveSyncPrefs());
  const [connected, setConnected] = useState(() => Boolean(getCachedGoogleToken()));
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const activeClientId = envClientId || clientId.trim();

  useEffect(() => {
    // Pre-warm Google Identity Services (https://accounts.google.com/gsi/client)
    // so clicking Sync triggers requestAccessToken() synchronously within the user gesture.
    void loadGsiClient().catch(() => undefined);
  }, []);

  async function runSync(promptMode: "" | "consent" | "select_account" = "") {
    if (!activeClientId) {
      toast.error("أدخل Google OAuth Client ID أولاً أو اضبط VITE_GOOGLE_CLIENT_ID");
      return;
    }
    setBusy(true);
    try {
      await requestGoogleDriveToken(activeClientId, promptMode);
      setConnected(true);
      const controller = getGoogleDriveSyncController(activeClientId);
      const localData = pickFinanceData(useFinance.getState());
      const localUpdatedAt = getLocalUpdatedAt();

      const res = await controller.sync(localData, localUpdatedAt);
      setLastResult(res);

      if (res.state.phase === "synced") {
        if (res.source === "remote") {
          const normalized = asData(res.data) ?? res.data;
          replaceAll({ ...normalized, demo: false }, res.remoteUpdatedAt ?? Date.now());
          toast.success("تم استرجاع النسخة الأحدث من Google Drive");
        } else if (res.source === "uploaded") {
          toast.success("تم رفع بياناتك إلى Google Drive بأمان");
        } else {
          toast.success("البيانات متطابقة ومحدّثة بالفعل");
        }
        const nextPrefs = { ...prefs, lastSyncedAt: Date.now() };
        setPrefs(nextPrefs);
        saveDriveSyncPrefs(nextPrefs);
      } else if (res.state.errorCode === "network") {
        toast.error("أنت غير متصل بالإنترنت — بياناتك محفوظة محلياً");
      } else if (res.state.errorCode === "unauthorized") {
        setConnected(false);
        toast.error("انتهت جلسة Google — اضغط مزامنة لإعادة التفويض");
      } else if (res.state.errorCode === "conflict") {
        toast.error("تعارض تحديث بين جهازين — أعد المزامنة");
      } else if (res.state.errorCode === "invalid-remote") {
        toast.error("الملف البعيد في Drive تالف؛ لم نغيّر بياناتك المحلية");
      } else {
        toast.error("تعذّرت المزامنة مع Google Drive");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("403")) {
        setConnected(false);
        toast.error("لم تُمنح صلاحية مجلد التطبيقات (drive.appdata) — أعد التفويض وفعّل الصلاحية");
      } else if (msg.includes("401")) {
        setConnected(false);
        toast.error("أُلغي تفويض Google Drive أو لم يكتمل");
      } else if (msg.includes("network") || msg.includes("timeout")) {
        toast.error("تعذّر تحميل مكتبة Google Identity — تحقّق من الاتصال بالإنترنت");
      } else {
        toast.error("تعذّر الاتصال بخدمة Google");
      }
    } finally {
      setBusy(false);
    }
  }

  function saveClientIdSetting() {
    setCustomGoogleClientId(clientId);
    resetGoogleDriveSyncController();
    toast.success(clientId.trim() ? "حُفظ Google Client ID محلياً" : "أُزيل Client ID المخصّص");
  }

  function toggleAutoSync(next: boolean) {
    const updated = { ...prefs, autoSync: next };
    setPrefs(updated);
    saveDriveSyncPrefs(updated);
    toast(next ? "فُعّلت المزامنة التلقائية في هذه الجلسة" : "أُوقفت المزامنة التلقائية");
  }

  function disconnectGoogle() {
    clearCachedGoogleToken();
    resetGoogleDriveSyncController();
    setConnected(false);
    setLastResult(null);
    const updated = { ...prefs, autoSync: false };
    setPrefs(updated);
    saveDriveSyncPrefs(updated);
    toast("فُصلت جلسة Google Drive — بياناتك المحلية كما هي");
  }

  const statusLabel =
    lastResult?.state.phase === "synced"
      ? "متزامن"
      : lastResult?.state.errorCode === "network"
        ? "غير متصل"
        : lastResult?.state.errorCode === "unauthorized"
          ? "يتطلب تفويضاً"
          : connected
            ? "متصل في هذه الجلسة"
            : activeClientId
              ? "جاهز للربط"
              : "ينتظر Client ID";

  return (
    <>
      <header data-stagger className="px-5 pt-2">
        <h1 className="tracking-title text-largetitle font-bold">مزامنة Drive</h1>
        <p className="mt-1 text-sub text-label-2">
          تطبيق ميزان يعمل محلياً أولاً، ويحفظ نسخة خاصة في مجلد التطبيقات المخفي (appDataFolder) على Google Drive.
        </p>
      </header>

      <Section title="الحالة">
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: connected ? "var(--green)" : "var(--tint)" }}>
                {connected ? <CheckCircle2 size={16} /> : <Cloud size={16} />}
              </span>
            }
            title={statusLabel}
            sub={`آخر مزامنة: ${formatSyncTime(prefs.lastSyncedAt)}`}
            trailing={
              <PillButton onClick={() => void runSync("")} disabled={busy || !activeClientId}>
                <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
                <span>{busy ? "جارٍ…" : "مزامنة الآن"}</span>
              </PillButton>
            }
          />
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--gray)" }}>
                <ShieldCheck size={16} />
              </span>
            }
            title="الخصوصية والنطاق"
            sub="نطاق drive.appdata فقط — لا يصل لبقية ملفات Drive"
          />
          {connected ? (
            <>
              <Row
                leading={
                  <span className="icon-tile" style={{ background: "var(--orange)" }}>
                    <CloudOff size={16} />
                  </span>
                }
                title="المزامنة التلقائية أثناء الجلسة"
                sub="رفع تلقائي عند تعديل السجل ما دامت الجلسة نشطة"
                trailing={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.autoSync}
                    aria-label="المزامنة التلقائية"
                    onClick={() => toggleAutoSync(!prefs.autoSync)}
                    className={`tap-target relative h-7 w-12 rounded-full transition-colors ${
                      prefs.autoSync ? "bg-green" : "bg-fill"
                    }`}
                  >
                    <span
                      className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                        prefs.autoSync ? "-translate-x-5.5" : "-translate-x-0.5"
                      }`}
                    />
                  </button>
                }
              />
              <Row
                leading={
                  <span className="icon-tile" style={{ background: "var(--tint)" }}>
                    <UserCheck size={16} />
                  </span>
                }
                title="تبديل حساب Google"
                sub="اختيار حساب آخر أو إعادة منح الأذونات"
                onClick={() => void runSync("select_account")}
              />
            </>
          ) : null}
        </Group>
      </Section>

      <Section
        title="إعداد Google Identity (OAuth)"
        footer={
          envClientId
            ? "يُقرأ معرّف التطبيق من متغير البيئة VITE_GOOGLE_CLIENT_ID."
            : "للمشاريع المستقلة: أنشئ Web Client ID في Google Cloud Console وأضف رابط التطبيق ضمن Authorized JavaScript Origins."
        }
      >
        <Group sep="icon">
          {envClientId ? (
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--tint)" }}>
                  <KeyRound size={16} />
                </span>
              }
              title="Client ID مضبوط من البيئة"
              sub={`${envClientId.slice(0, 14)}…`}
            />
          ) : (
            <div className="px-4 py-3">
              <label className="block text-foot font-medium text-label-2" htmlFor="gis-client-id">
                Google OAuth Client ID
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="gis-client-id"
                  dir="ltr"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890-xxxx.apps.googleusercontent.com"
                  className="field min-w-0 flex-1 rounded-inner bg-fill px-3 text-sub"
                />
                <PillButton tone="gray" onClick={saveClientIdSetting}>
                  حفظ
                </PillButton>
              </div>
            </div>
          )}
          {connected ? (
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--red)" }}>
                  <Unlink size={16} />
                </span>
              }
              title="فصل جلسة Google"
              sub="يمسح رمز الجلسة المؤقت فقط دون مسح بياناتك"
              destructive
              onClick={disconnectGoogle}
            />
          ) : null}
        </Group>
      </Section>
    </>
  );
}
