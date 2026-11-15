import {
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  CloudOff,
  History,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlink,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Group, PillButton, Row, Section } from "@/components/finance/ui";
import { shortDate } from "@/lib/finance/logic";
import {
  asData,
  getLocalUpdatedAt,
  getPendingCloudSync,
  pickFinanceData,
  setPendingCloudSync,
  useFinance,
} from "@/lib/finance/store";
import type { SyncConflictInfo, SyncResult } from "@/lib/sync/drive-sync";
import {
  clearCachedGoogleToken,
  createDriveBackupSnapshot,
  getCachedGoogleToken,
  getConfiguredGoogleClientId,
  getDriveEncryptionPassphrase,
  getEnvGoogleClientId,
  getGoogleDriveSyncController,
  listDriveBackupSnapshots,
  loadDriveSyncPrefs,
  loadGsiClient,
  requestGoogleDriveToken,
  resetGoogleDriveSyncController,
  restoreDriveBackupSnapshot,
  saveDriveSyncPrefs,
  setCustomGoogleClientId,
  setDriveEncryptionPassphrase,
  type DriveBackupSnapshot,
} from "@/lib/sync/google-drive-gis";

function formatSyncTime(ts?: number | string) {
  if (!ts) return "لم تتم بعد";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "لم تتم بعد";
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
  const [conflict, setConflict] = useState<SyncConflictInfo | null>(null);
  const [passphrase, setPassphrase] = useState(() => getDriveEncryptionPassphrase());
  const [snapshots, setSnapshots] = useState<DriveBackupSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const pendingLocal = getPendingCloudSync();

  const activeClientId = envClientId || clientId.trim();

  useEffect(() => {
    void loadGsiClient().catch(() => undefined);
  }, []);

  const refreshSnapshots = useCallback(async () => {
    if (!activeClientId || !getCachedGoogleToken()) return;
    setLoadingSnapshots(true);
    try {
      const list = await listDriveBackupSnapshots(activeClientId);
      setSnapshots(list);
    } catch {
      // Ignore snapshot listing failures when offline or unauthorized
    } finally {
      setLoadingSnapshots(false);
    }
  }, [activeClientId]);

  useEffect(() => {
    if (connected) {
      void refreshSnapshots();
    }
  }, [connected, refreshSnapshots]);

  async function runSync(
    promptMode: "" | "consent" | "select_account" = "",
    conflictMode: "prompt" | "force-local" = "prompt",
  ) {
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

      const res = await controller.sync(localData, localUpdatedAt, { conflictMode });
      setLastResult(res);

      if (res.source === "conflict" && res.conflict) {
        setConflict(res.conflict);
        toast("توجد نسختان مختلفتان — اختر النسخة التي تريد اعتمادها");
        return;
      }

      setConflict(null);

      if (res.state.phase === "synced") {
        setPendingCloudSync(false);
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
        void refreshSnapshots();
      } else if (res.state.errorCode === "encrypted") {
        toast.error("النسخة في Drive مشفّرة — أدخل عبارة التشفير في الأسفل ثم أعد المزامنة");
      } else if (res.state.errorCode === "wrong-passphrase") {
        toast.error("عبارة التشفير غير صحيحة لفك نسخة Drive");
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

  function acceptRemoteConflict() {
    if (!conflict) return;
    const normalized = asData(conflict.remoteData) ?? conflict.remoteData;
    replaceAll({ ...normalized, demo: false }, conflict.remoteUpdatedAt);
    setPendingCloudSync(false);
    setConflict(null);
    const nextPrefs = { ...prefs, lastSyncedAt: Date.now() };
    setPrefs(nextPrefs);
    saveDriveSyncPrefs(nextPrefs);
    toast.success("تم اعتماد نسخة السحابة");
  }

  function saveClientIdSetting() {
    setCustomGoogleClientId(clientId);
    resetGoogleDriveSyncController();
    toast.success(clientId.trim() ? "حُفظ Google Client ID محلياً" : "أُزيل Client ID المخصّص");
  }

  function savePassphraseSetting() {
    setDriveEncryptionPassphrase(passphrase);
    resetGoogleDriveSyncController();
    toast.success(passphrase.trim() ? "فُعّل تشفير Drive بعبارة سرية محلية" : "أُلغي تشفير عبارة المرور لـ Drive");
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
    setConflict(null);
    setSnapshots([]);
    const updated = { ...prefs, autoSync: false };
    setPrefs(updated);
    saveDriveSyncPrefs(updated);
    toast("فُصلت جلسة Google Drive — بياناتك المحلية كما هي");
  }

  async function saveCloudSnapshot() {
    if (!activeClientId) return;
    setBusy(true);
    try {
      await requestGoogleDriveToken(activeClientId, "");
      const localData = pickFinanceData(useFinance.getState());
      await createDriveBackupSnapshot(activeClientId, localData, getLocalUpdatedAt());
      toast.success("تم حفظ نسخة تاريخية جديدة في السحابة");
      await refreshSnapshots();
    } catch {
      toast.error("تعذّر حفظ النسخة التاريخية");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSnapshot(fileId: string) {
    if (!activeClientId) return;
    setBusy(true);
    try {
      await requestGoogleDriveToken(activeClientId, "");
      const { data: snapData, updatedAt } = await restoreDriveBackupSnapshot(activeClientId, fileId);
      const normalized = asData(snapData) ?? snapData;
      replaceAll({ ...normalized, demo: false }, updatedAt);
      setPendingCloudSync(false);
      toast.success("تم استرجاع النسخة التاريخية بنجاح");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("wrong_passphrase") || msg.includes("decrypt")) {
        toast.error("عبارة التشفير غير صحيحة لهذه النسخة");
      } else if (msg.includes("encrypted")) {
        toast.error("النسخة مشفّرة — أدخل عبارة التشفير أولاً");
      } else {
        toast.error("تعذّر استرجاع النسخة");
      }
    } finally {
      setBusy(false);
    }
  }

  const statusLabel =
    lastResult?.state.phase === "synced"
      ? "متزامن"
      : pendingLocal
        ? "تغييرات محلية بانتظار المزامنة"
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

      {conflict ? (
        <Section title="تعارض بين نسختين" footer="قارن بين النسخة المحلية والسحابية واختر إحداهما قبل الاستمرار.">
          <div className="surface-card mx-4 space-y-3 rounded-cell p-4">
            <div className="grid grid-cols-2 gap-3 text-caption">
              <div className="rounded-inner bg-fill p-3">
                <p className="font-semibold text-label">هذا الجهاز</p>
                <p className="mt-1 text-label-2">{formatSyncTime(conflict.localUpdatedAt)}</p>
                <p className="mt-2">
                  {conflict.localCounts.txCount} حركة · {conflict.localCounts.debtCount} دين ·{" "}
                  {conflict.localCounts.goalCount} هدف
                </p>
              </div>
              <div className="rounded-inner bg-fill p-3">
                <p className="font-semibold text-label">Google Drive</p>
                <p className="mt-1 text-label-2">{formatSyncTime(conflict.remoteUpdatedAt)}</p>
                <p className="mt-2">
                  {conflict.remoteCounts.txCount} حركة · {conflict.remoteCounts.debtCount} دين ·{" "}
                  {conflict.remoteCounts.goalCount} هدف
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <PillButton onClick={() => void runSync("", "force-local")} disabled={busy}>
                الاحتفاظ بالمحلي ورفعه
              </PillButton>
              <PillButton tone="gray" onClick={acceptRemoteConflict} disabled={busy}>
                اعتماد نسخة السحابة
              </PillButton>
            </div>
          </div>
        </Section>
      ) : null}

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
                sub="رفع تلقائي عند تعديل السجل أو عودة الإنترنت"
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
        title="تشفير طرف لطرف (اختياري)"
        footer="إذا أدخلت عبارة سرية هنا، تُشفّر بياناتك محلياً بـ AES-256-GCM قبل رفعها إلى Google Drive. لا يمكن استرجاع البيانات بدون نفس العبارة."
      >
        <Group sep="icon">
          <div className="px-4 py-3">
            <label className="flex items-center gap-2 text-foot font-medium text-label-2" htmlFor="drive-enc-pass">
              <Lock size={14} />
              <span>عبارة تشفير النسخة السحابية</span>
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="drive-enc-pass"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="اتركه فارغاً للتشفير الافتراضي من Google فقط"
                className="field min-w-0 flex-1 rounded-inner bg-fill px-3 text-sub"
              />
              <PillButton tone="gray" onClick={savePassphraseSetting}>
                حفظ
              </PillButton>
            </div>
          </div>
        </Group>
      </Section>

      {connected ? (
        <Section
          title="سجل النسخ التاريخية (آخر 8 نسخ)"
          footer="يمكنك حفظ لقطة يدوية أو الرجوع إلى أي نسخة سابقة محفوظة في appDataFolder."
        >
          <Group sep="icon">
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--tint)" }}>
                  <History size={16} />
                </span>
              }
              title="حفظ نسخة تاريخية الآن"
              sub="يُحتفظ بآخر 8 نسخ تلقائياً"
              trailing={
                <PillButton tone="gray" onClick={() => void saveCloudSnapshot()} disabled={busy}>
                  حفظ نسخة
                </PillButton>
              }
            />
            {loadingSnapshots ? (
              <Row title="جارٍ تحميل النسخ…" />
            ) : snapshots.length === 0 ? (
              <Row title="لا توجد نسخ تاريخية بعد" sub="اضغط «حفظ نسخة» لإنشاء أول لقطة" />
            ) : (
              snapshots.map((snap) => (
                <Row
                  key={snap.id}
                  leading={
                    <span className="icon-tile" style={{ background: "var(--gray)" }}>
                      <ArchiveRestore size={16} />
                    </span>
                  }
                  title={formatSyncTime(snap.modifiedTime)}
                  sub={snap.sizeBytes ? `${Math.max(1, Math.round(snap.sizeBytes / 1024))} ك.ب` : snap.name}
                  trailing={
                    <PillButton tone="gray" onClick={() => void restoreSnapshot(snap.id)} disabled={busy}>
                      استرجاع
                    </PillButton>
                  }
                />
              ))
            )}
          </Group>
        </Section>
      ) : null}

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
