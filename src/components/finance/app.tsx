import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Crown,
  Ellipsis,
  FileSpreadsheet,
  HardDrive,
  House,
  Lock,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  MizanContext,
  type DebtTabFilter,
  type Route,
  type SheetState,
  type Tab,
} from "@/components/finance/context";
import { ErrorBoundary } from "@/components/finance/error-boundary";
import { MotionScreen } from "@/components/finance/gsap-motion";
import {
  DebtScreen,
  DebtsScreen,
  HomeScreen,
  LedgerScreen,
  MoreScreen,
  PeopleScreen,
  PersonScreen,
} from "@/components/finance/screens";
import { SplashScreen } from "@/components/finance/splash-screen";
import { PillButton } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { formatNumber, shiftMonthKey, currentMonth, debtTotals } from "@/lib/finance/logic";
import { useI18n } from "@/lib/finance/i18n";
import { markBootStart, recordBootMetrics } from "@/lib/finance/perf-metrics";
import { installMobileKeyboardScrollAssist } from "@/lib/mobile-safe";
import { readPinHash, writePinHash } from "@/lib/finance/pin";
import { applyDocumentLanguageAndDir } from "@/lib/finance/prefs";
import {
  applyPrivacyScreenFlag,
  loadSecuritySettings,
  shouldAutoLock,
  useSecuritySettings,
} from "@/lib/finance/security";
import {
  getLocalUpdatedAt,
  getPendingCloudSync,
  pickFinanceData,
  setPendingCloudSync,
  useFinance,
} from "@/lib/finance/store";
import {
  cancelTaskNotification,
  registerNotificationActionListener,
  scheduleAllTaskNotifications,
  scheduleTaskNotification,
} from "@/lib/notifications/scheduler";
import {
  ACTION_MARK_PAID,
  ACTION_SNOOZE_DAY,
  executeNotificationAction,
  loadScheduledTasks,
} from "@/lib/notifications/tasks";
import {
  getCachedGoogleToken,
  getConfiguredGoogleClientId,
  getGoogleDriveSyncController,
  loadDriveSyncPrefs,
  saveDriveSyncPrefs,
} from "@/lib/sync/google-drive-gis";
import { TenantProvider, useTenant, type InitialTestSession } from "@/lib/tenant/context";
import { updateMyPassword } from "@/lib/tenant/api";
import { formatRoleLabel } from "@/lib/tenant/types";

const AuthScreen = lazy(() => import("@/components/finance/auth-screen").then((m) => ({ default: m.AuthScreen })));
const SubscriptionGateScreen = lazy(() =>
  import("@/components/finance/subscription-gate-screen").then((m) => ({ default: m.SubscriptionGateScreen })),
);
const WorkspaceSwitcherSheet = lazy(() =>
  import("@/components/finance/workspace-switcher").then((m) => ({ default: m.WorkspaceSwitcherSheet })),
);
const TenantSettingsScreen = lazy(() =>
  import("@/components/finance/tenant-settings-screen").then((m) => ({ default: m.TenantSettingsScreen })),
);
const SuperAdminScreen = lazy(() =>
  import("@/components/finance/super-admin-screen").then((m) => ({ default: m.SuperAdminScreen })),
);

const ReportScreen = lazy(() => import("@/components/finance/features").then((m) => ({ default: m.ReportScreen })));
const GoalsScreen = lazy(() => import("@/components/finance/features").then((m) => ({ default: m.GoalsScreen })));
const GoalScreen = lazy(() => import("@/components/finance/features").then((m) => ({ default: m.GoalScreen })));
const WalletsScreen = lazy(() => import("@/components/finance/features").then((m) => ({ default: m.WalletsScreen })));
const RecurringScreen = lazy(() =>
  import("@/components/finance/features").then((m) => ({ default: m.RecurringScreen })),
);
const LockScreen = lazy(() => import("@/components/finance/features").then((m) => ({ default: m.LockScreen })));

const DriveSyncScreen = lazy(() =>
  import("@/components/finance/drive-sync-screen").then((m) => ({ default: m.DriveSyncScreen })),
);
const NotificationsScreen = lazy(() =>
  import("@/components/finance/notifications-screen").then((m) => ({ default: m.NotificationsScreen })),
);
const SecurityScreen = lazy(() =>
  import("@/components/finance/security-screen").then((m) => ({ default: m.SecurityScreen })),
);

const TxnForm = lazy(() => import("@/components/finance/forms").then((m) => ({ default: m.TxnForm })));
const PersonForm = lazy(() => import("@/components/finance/forms").then((m) => ({ default: m.PersonForm })));
const DebtForm = lazy(() => import("@/components/finance/forms").then((m) => ({ default: m.DebtForm })));
const PayForm = lazy(() => import("@/components/finance/forms").then((m) => ({ default: m.PayForm })));
const ResetForm = lazy(() => import("@/components/finance/forms").then((m) => ({ default: m.ResetForm })));

const TransferForm = lazy(() =>
  import("@/components/finance/feature-forms").then((m) => ({ default: m.TransferForm })),
);
const WalletForm = lazy(() => import("@/components/finance/feature-forms").then((m) => ({ default: m.WalletForm })));
const DesignStudioSheet = lazy(() =>
  import("@/components/finance/feature-forms").then((m) => ({ default: m.DesignStudioSheet })),
);
const RecurringForm = lazy(() =>
  import("@/components/finance/feature-forms").then((m) => ({ default: m.RecurringForm })),
);
const SplitForm = lazy(() => import("@/components/finance/feature-forms").then((m) => ({ default: m.SplitForm })));
const GoalForm = lazy(() => import("@/components/finance/feature-forms").then((m) => ({ default: m.GoalForm })));
const GoalMoveForm = lazy(() =>
  import("@/components/finance/feature-forms").then((m) => ({ default: m.GoalMoveForm })),
);
const PinForm = lazy(() => import("@/components/finance/feature-forms").then((m) => ({ default: m.PinForm })));

const UnifiedSearchSheet = lazy(() =>
  import("@/components/finance/search-sheet").then((m) => ({ default: m.UnifiedSearchSheet })),
);
const CsvImportSheet = lazy(() =>
  import("@/components/finance/csv-import-sheet").then((m) => ({ default: m.CsvImportSheet })),
);

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type MizanRootProps = {
  skipSplash?: boolean;
  requestedSlug?: string;
  requestedInviteCode?: string;
  initialRoute?: Route;
  initialSession?: InitialTestSession;
};

export function MizanRoot({
  skipSplash = false,
  requestedSlug,
  requestedInviteCode,
  initialRoute,
  initialSession,
}: MizanRootProps) {
  useEffect(() => {
    installMobileKeyboardScrollAssist();
  }, []);

  return (
    <ErrorBoundary scopeName="mizan-root">
      <TenantProvider
        requestedSlug={requestedSlug}
        requestedInviteCode={requestedInviteCode}
        initialSession={initialSession}
      >
        <TenantAuthGate
          skipSplash={skipSplash}
          requestedInviteCode={requestedInviteCode}
          initialRoute={initialRoute}
        />
      </TenantProvider>
    </ErrorBoundary>
  );
}

function sameRoute(a: Route, b: Route) {
  if (a.name !== b.name) return false;
  const aid = "id" in a ? a.id : "";
  const bid = "id" in b ? b.id : "";
  return aid === bid;
}

function ScreenFallback() {
  const { lang } = useI18n();
  return (
    <div className="flex min-h-48 items-center justify-center px-6 py-12 text-sub text-label-2">
      {lang === "en" ? "Loading…" : "جارٍ التحميل…"}
    </div>
  );
}

function SheetFallback() {
  return null;
}

function TenantAuthGate({
  skipSplash,
  requestedInviteCode,
  initialRoute,
}: {
  skipSplash: boolean;
  requestedInviteCode?: string;
  initialRoute?: Route;
}) {
  const {
    authStatus,
    activeTenant,
    subscriptionBlockReason,
    passwordRecoveryPending,
    pendingInvitePrompt,
    pendingLegacyMigration,
    clearPasswordRecovery,
    confirmPendingInvite,
    dismissPendingInvite,
    confirmLegacyMigration,
    dismissLegacyMigration,
  } = useTenant();
  const { lang, dir } = useI18n();
  const [showSplash, setShowSplash] = useState(!skipSplash);
  const [newRecoveryPass, setNewRecoveryPass] = useState("");
  const [savingRecoveryPass, setSavingRecoveryPass] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState(false);

  useIsomorphicLayoutEffect(() => {
    markBootStart();
    applyDocumentLanguageAndDir(lang);
    if (skipSplash) {
      recordBootMetrics(0);
    }
  }, []);

  useEffect(() => {
    applyDocumentLanguageAndDir(lang);
  }, [lang]);

  const handleSaveRecoveryPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newRecoveryPass.length < 6) {
      toast.error(lang === "en" ? "Password must be at least 6 characters" : "كلمة المرور 6 أحرف على الأقل");
      return;
    }
    setSavingRecoveryPass(true);
    try {
      await updateMyPassword(newRecoveryPass);
      setNewRecoveryPass("");
      clearPasswordRecovery();
      toast.success(lang === "en" ? "Password updated successfully" : "تم تحديث كلمة المرور بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingRecoveryPass(false);
    }
  };

  return (
    <div dir={dir}>
      {authStatus === "loading" ? (
        <div className="flex min-h-dvh items-center justify-center bg-[var(--surround)] text-sub text-[var(--label-2)]">
          {lang === "en" ? "Loading workspaces…" : "جارٍ تجهيز مساحات العمل…"}
        </div>
      ) : authStatus === "unauthenticated" || !activeTenant ? (
        <Suspense fallback={<ScreenFallback />}>
          <AuthScreen initialInviteCode={requestedInviteCode} />
        </Suspense>
      ) : subscriptionBlockReason ? (
        <Suspense fallback={<ScreenFallback />}>
          <SubscriptionGateScreen reason={subscriptionBlockReason} />
        </Suspense>
      ) : (
        <App initialRoute={initialRoute} />
      )}

      {passwordRecoveryPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveRecoveryPassword}
            className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--sep)] p-5 space-y-3 shadow-xl"
          >
            <div className="font-bold text-[16px]">
              {lang === "en" ? "Set New Password" : "تعيين كلمة مرور جديدة"}
            </div>
            <p className="text-[12px] text-[var(--label-3)]">
              {lang === "en"
                ? "Enter a new password for your Mizan account."
                : "أدخل كلمة المرور الجديدة لحسابك في ميزان."}
            </p>
            <input
              type="password"
              dir="ltr"
              minLength={6}
              value={newRecoveryPass}
              onChange={(e) => setNewRecoveryPass(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px]"
              required
            />
            <div className="flex items-center gap-2">
              <PillButton type="submit" disabled={savingRecoveryPass} className="flex-1 h-10 text-[13px] justify-center">
                {savingRecoveryPass
                  ? lang === "en"
                    ? "Saving…"
                    : "جارٍ الحفظ…"
                  : lang === "en"
                    ? "Save Password"
                    : "حفظ كلمة المرور"}
              </PillButton>
              <button
                type="button"
                onClick={clearPasswordRecovery}
                className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
              >
                {lang === "en" ? "Cancel" : "إلغاء"}
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingInvitePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--sep)] p-5 space-y-3 shadow-xl">
            <div className="font-bold text-[16px]">
              {lang === "en" ? "Workspace Invitation" : "تأكيد الانضمام إلى مساحة عمل"}
            </div>
            <p className="text-[12px] text-[var(--label-3)] leading-relaxed">
              {lang === "en"
                ? `Do you want to join "${pendingInvitePrompt.workspaceName ?? pendingInvitePrompt.code}"${pendingInvitePrompt.role ? ` as ${formatRoleLabel(pendingInvitePrompt.role, "en")}` : ""}? Your name and verified account email will be visible to workspace members.`
                : `هل ترغب في الانضمام إلى مساحة «${pendingInvitePrompt.workspaceName ?? pendingInvitePrompt.code}»${pendingInvitePrompt.role ? ` بدور ${formatRoleLabel(pendingInvitePrompt.role, "ar")}` : ""}؟ سيظهر اسمك وبريدك لأعضاء المساحة بعد الموافقة.`}
            </p>
            <div className="flex items-center gap-2">
              <PillButton
                type="button"
                disabled={acceptingInvite}
                onClick={async () => {
                  setAcceptingInvite(true);
                  try {
                    await confirmPendingInvite();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : lang === "en" ? "Failed to join" : "تعذّر قبول الدعوة");
                  } finally {
                    setAcceptingInvite(false);
                  }
                }}
                className="flex-1 h-10 text-[13px] justify-center"
              >
                {acceptingInvite
                  ? lang === "en"
                    ? "Joining…"
                    : "جارٍ الانضمام…"
                  : lang === "en"
                    ? "Accept & Join"
                    : "قبول الدعوة والانضمام"}
              </PillButton>
              <button
                type="button"
                disabled={acceptingInvite}
                onClick={dismissPendingInvite}
                className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
              >
                {lang === "en" ? "Decline" : "رفض"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingLegacyMigration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--sep)] p-5 space-y-3 shadow-xl">
            <div className="font-bold text-[16px]">
              {lang === "en" ? "Import Local Ledger Data?" : "استيراد البيانات المالية المحلية؟"}
            </div>
            <p className="text-[12px] text-[var(--label-3)] leading-relaxed">
              {lang === "en"
                ? `Found local ledger records on this device. Sync them to workspace "${pendingLegacyMigration.targetWorkspaceName}" under account (${pendingLegacyMigration.targetAccountEmail})?`
                : `توجد سجلات مالية محلية محفوظة على هذا الجهاز. هل تريد ترحيلها ومزامنتها مع مساحة «${pendingLegacyMigration.targetWorkspaceName}» التابعة للحساب (${pendingLegacyMigration.targetAccountEmail})؟`}
            </p>
            <div className="flex items-center gap-2">
              <PillButton
                type="button"
                onClick={confirmLegacyMigration}
                className="flex-1 h-10 text-[13px] justify-center"
              >
                {lang === "en" ? "Import & Sync" : "نعم، استيراد ومزامنة"}
              </PillButton>
              <button
                type="button"
                onClick={dismissLegacyMigration}
                className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
              >
                {lang === "en" ? "Skip" : "تخطي"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSplash ? (
        <SplashScreen
          onDone={(durationMs) => {
            recordBootMetrics(durationMs);
            setShowSplash(false);
          }}
        />
      ) : null}

      <Toaster position="top-center" dir={dir} offset={12} />
    </div>
  );
}

function App({ initialRoute }: { initialRoute?: Route }) {
  const { lang, numeralStyle, dir, isRtl, t } = useI18n();
  const {
    activeTenant,
    canWrite,
    isSuperAdmin,
    isOnline,
    syncStatus,
    pendingOpsCount,
    rejectedSyncItems,
    migratedLegacyNotice,
    dismissMigratedNotice,
    dismissRejectedSync,
    syncNow,
  } = useTenant();
  const [tab, setTabState] = useState<Tab>("home");
  const [month, setMonth] = useState(currentMonth);
  const [stack, setStack] = useState<Route[]>(initialRoute ? [{ name: "main" }, initialRoute] : [{ name: "main" }]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [debtFilter, setDebtFilter] = useState<DebtTabFilter>("open");
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState("");
  const [query, setQuery] = useState("");
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pinHash, setPinHashState] = useState<string | null>(null);
  const [backgroundMasked, setBackgroundMasked] = useState(false);
  const lastActiveRef = useRef<number>(Date.now());
  const prevTenantIdRef = useRef<string | null>(activeTenant?.id ?? null);
  const security = useSecuritySettings();

  const route = stack[stack.length - 1] ?? { name: "main" };

  const tabs: { id: Tab; label: string; icon: typeof House }[] = [
    { id: "home", label: t("tabHome"), icon: House },
    { id: "ledger", label: t("tabLedger"), icon: Wallet },
    { id: "debts", label: t("tabDebts"), icon: Scale },
    { id: "people", label: t("tabPeople"), icon: Users },
    { id: "more", label: t("tabMore"), icon: Ellipsis },
  ];

  // Reset navigation stack gracefully on tenant switch
  useEffect(() => {
    if (!activeTenant) return;
    if (prevTenantIdRef.current && prevTenantIdRef.current !== activeTenant.id) {
      setTabState("home");
      setStack([{ name: "main" }]);
      setQuery("");
      setCompact(false);
    }
    prevTenantIdRef.current = activeTenant.id;
  }, [activeTenant?.id, activeTenant]);

  useIsomorphicLayoutEffect(() => {
    setPinHashState(readPinHash());
    applyPrivacyScreenFlag(loadSecuritySettings().hideBalancesInRecents);
  }, []);

  useEffect(() => {
    applyPrivacyScreenFlag(security.hideBalancesInRecents);
  }, [security.hideBalancesInRecents]);

  useEffect(() => {
    const win = window as Window & { __mizanBack?: () => boolean };
    win.__mizanBack = () => {
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (stack.length > 1) {
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : [{ name: "main" }]));
        setCompact(false);
        return true;
      }
      if (tab !== "home") {
        setTabState("home");
        setStack([{ name: "main" }]);
        setQuery("");
        setCompact(false);
        return true;
      }
      return false;
    };
    return () => {
      delete win.__mizanBack;
    };
  }, [sheet, stack.length, tab]);

  useEffect(() => {
    void scheduleAllTaskNotifications();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "expense") setSheet({ kind: "txn", prefill: { kind: "expense" } });
      else if (action === "income") setSheet({ kind: "txn", prefill: { kind: "income" } });
      else if (action === "debt") setSheet({ kind: "debt" });
      else if (action === "search") setSheet({ kind: "search" });
      else if (action === "import") setSheet({ kind: "csv-import" });
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void registerNotificationActionListener((action) => {
      const extra = (action.notification.extra ?? {}) as { taskId?: string };
      const taskId = extra.taskId;
      if (!taskId) return;
      const task = loadScheduledTasks().find((item) => item.id === taskId);
      if (!task) return;
      const state = useFinance.getState();
      const res = executeNotificationAction(action.actionId, task, {
        getData: () => pickFinanceData(useFinance.getState()),
        addPayment: state.addPayment,
        confirmRecurring: state.confirmRecurring,
        addTxn: state.addTxn,
      });
      if (action.actionId === ACTION_SNOOZE_DAY && res.updatedTask) {
        void scheduleTaskNotification(res.updatedTask);
      } else if (action.actionId === ACTION_MARK_PAID) {
        void cancelTaskNotification(task.id);
      }
      if (res.message) toast(res.message);
    }).then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!pinHash) return;
    if (unlocked) lastActiveRef.current = Date.now();

    const recordActivity = () => {
      if (unlocked) lastActiveRef.current = Date.now();
    };
    const handleVisibility = () => {
      const sec = loadSecuritySettings();
      if (document.visibilityState === "hidden") {
        if (sec.hideBalancesInRecents) setBackgroundMasked(true);
        if (sec.autoLockMinutes === 0 && unlocked) {
          setUnlocked(false);
        }
      } else {
        setBackgroundMasked(false);
        if (unlocked && shouldAutoLock(lastActiveRef.current, Date.now(), sec.autoLockMinutes, true)) {
          setUnlocked(false);
        }
      }
    };
    const interval = window.setInterval(() => {
      const sec = loadSecuritySettings();
      if (unlocked && sec.autoLockMinutes > 0 && shouldAutoLock(lastActiveRef.current, Date.now(), sec.autoLockMinutes, true)) {
        setUnlocked(false);
      }
    }, 15_000);

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pinHash, unlocked]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const triggerAutoSync = () => {
      const prefs = loadDriveSyncPrefs();
      const clientId = getConfiguredGoogleClientId();
      if (!prefs.autoSync || !clientId || !getCachedGoogleToken()) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const controller = getGoogleDriveSyncController(clientId);
        const state = useFinance.getState();
        void controller
          .sync(pickFinanceData(state), getLocalUpdatedAt(), { conflictMode: "auto" })
          .then((res) => {
            if (res.source === "remote") {
              state.replaceAll({ ...res.data, demo: false }, res.remoteUpdatedAt ?? Date.now());
            }
            if (res.state.phase === "synced") {
              setPendingCloudSync(false);
              saveDriveSyncPrefs({ ...loadDriveSyncPrefs(), lastSyncedAt: Date.now() });
            }
          })
          .catch(() => undefined);
      }, 2500);
    };

    const unsubscribe = useFinance.subscribe(triggerAutoSync);
    const onOnline = () => {
      if (getPendingCloudSync()) triggerAutoSync();
    };
    window.addEventListener("online", onOnline);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const people = useFinance((s) => s.people);
  const debts = useFinance((s) => s.debts);
  const payments = useFinance((s) => s.payments);
  const goals = useFinance((s) => s.goals);
  const overdue = debtTotals(debts, payments).overdue;

  function setPinHash(hash: string | null) {
    writePinHash(hash);
    setPinHashState(hash);
    if (!hash) setUnlocked(true);
    else lastActiveRef.current = Date.now();
  }

  function pushRoute(next: Route) {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && sameRoute(top, next)) return prev;
      return [...prev, next];
    });
    setCompact(false);
  }

  function back() {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : [{ name: "main" }]));
    setCompact(false);
  }

  function setTab(next: Tab) {
    setTabState(next);
    setStack([{ name: "main" }]);
    setQuery("");
    setCompact(false);
  }

  function openDebtsFiltered(filter: DebtTabFilter) {
    setDebtFilter(filter);
    setTab("debts");
  }

  function openLedgerFiltered(categoryId?: string) {
    setLedgerCategoryFilter(categoryId ?? "");
    setTab("ledger");
  }

  const title = heading(tab, route, people, debts, goals, lang);

  function openAdd() {
    if (!canWrite) {
      toast.info(
        activeTenant?.subscriptionStatus === "suspended"
          ? lang === "en"
            ? "Workspace is suspended — export is available"
            : "المساحة موقوفة مؤقتًا — التصدير متاح"
          : lang === "en"
            ? "Viewer role is read-only"
            : "صلاحية مشاهد (Viewer) للقراءة فقط",
      );
      return;
    }
    if (tab === "debts") setSheet({ kind: "debt" });
    else if (tab === "people") setSheet({ kind: "person" });
    else setSheet({ kind: "txn" });
  }

  function guardedOpenSheet(next: Exclude<SheetState, null>) {
    const readOnlyAllowed =
      next.kind === "search" || next.kind === "workspace-switcher" || next.kind === "design";
    if (!canWrite && !readOnlyAllowed) {
      toast.info(
        activeTenant?.subscriptionStatus === "suspended"
          ? lang === "en"
            ? "Workspace is suspended — editing disabled"
            : "المساحة موقوفة — التعديل غير متاح"
          : lang === "en"
            ? "Read-only permission (Viewer)"
            : "صلاحيتك في هذه المساحة للقراءة فقط",
      );
      return;
    }
    setSheet(next);
  }

  const showAdd = route.name === "main" && tab !== "more" && canWrite;
  const locked = Boolean(pinHash) && !unlocked;
  const BackChevron = isRtl ? ChevronRight : ChevronLeft;

  return (
    <MizanContext.Provider
      value={{
        tab,
        setTab,
        month,
        shiftMonth: (d) => setMonth((m) => shiftMonthKey(m, d)),
        route,
        openPerson: (id) => pushRoute({ name: "person", id }),
        openDebt: (id) => pushRoute({ name: "debt", id }),
        openReport: () => pushRoute({ name: "report" }),
        openGoals: () => pushRoute({ name: "goals" }),
        openGoal: (id) => pushRoute({ name: "goal", id }),
        openWallets: () => pushRoute({ name: "wallets" }),
        openRecurring: () => pushRoute({ name: "recurring" }),
        openNotifications: () => pushRoute({ name: "notifications" }),
        openDrive: () => pushRoute({ name: "drive" }),
        openSecurity: () => pushRoute({ name: "security" }),
        openTenant: () => pushRoute({ name: "tenant" }),
        openAdmin: () => pushRoute({ name: "admin" }),
        openDebtsFiltered,
        openLedgerFiltered,
        debtFilter,
        setDebtFilter,
        ledgerCategoryFilter,
        setLedgerCategoryFilter,
        back,
        sheet,
        openSheet: guardedOpenSheet,
        closeSheet: () => setSheet(null),
        query,
        setQuery,
        frame,
        pinHash,
        setPinHash,
      }}
    >
      <div
        dir={dir}
        className="fixed inset-0 flex min-w-0 max-w-full justify-center overflow-hidden bg-surround text-label lg:p-4"
      >
        <div
          ref={setFrame}
          className="relative flex h-full min-w-0 w-full max-w-full flex-col overflow-hidden bg-grouped md:max-w-2xl lg:max-w-6xl lg:flex-row lg:rounded-card lg:shadow-2xl"
        >
          {!locked ? (
            <aside
              aria-label={lang === "en" ? "Desktop Navigation" : "القائمة الجانبية"}
              className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:justify-between lg:border-e lg:border-separator/60 lg:bg-cell/80 lg:p-4"
            >
              <div>
                <div className="flex items-center gap-3 px-2 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-cell bg-tint text-on-tint shadow-sm">
                    <Scale size={20} strokeWidth={2.1} aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-headline font-bold leading-tight text-label">{t("appName")}</p>
                    <p className="text-caption text-label-2">{t("appTagline")}</p>
                  </div>
                </div>

                {activeTenant ? (
                  <button
                    type="button"
                    onClick={() => setSheet({ kind: "workspace-switcher" })}
                    className="mt-3 flex w-full items-center justify-between gap-2 rounded-cell border border-separator/70 bg-fill/70 px-3 py-2 text-start hover:bg-fill"
                    aria-label={lang === "en" ? "Switch Workspace" : "تبديل مساحة العمل"}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sub font-bold text-label truncate">
                        {activeTenant.mode === "cloud" ? (
                          <Cloud size={14} className="text-tint shrink-0" />
                        ) : (
                          <HardDrive size={14} className="text-warn shrink-0" />
                        )}
                        <span className="truncate">{activeTenant.name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-caption text-label-2">
                        <span>{formatRoleLabel(activeTenant.role, lang)}</span>
                        {!isOnline ? (
                          <span>· {lang === "en" ? "Offline" : "أوفلاين"}</span>
                        ) : pendingOpsCount > 0 ? (
                          <span>· {pendingOpsCount} {lang === "en" ? "queued" : "بانتظار المزامنة"}</span>
                        ) : null}
                      </div>
                    </div>
                    <ChevronDown size={15} className="text-label-2 shrink-0" />
                  </button>
                ) : null}

                <nav className="mt-4 space-y-1" aria-label={lang === "en" ? "Primary Sections" : "الأقسام الرئيسية"}>
                  {tabs.map((item) => {
                    const on = tab === item.id && route.name === "main";
                    const Icon = item.icon;
                    const badge = item.id === "debts" ? overdue : 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={on ? "page" : undefined}
                        onClick={() => setTab(item.id)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-cell px-3 text-start text-sub font-semibold transition",
                          on ? "bg-tint/12 text-tint" : "text-label-2 hover:bg-fill/70 hover:text-label",
                        )}
                      >
                        <Icon size={19} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        {badge > 0 ? (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-pill bg-expense px-1.5 text-caption2 text-on-tint">
                            {formatNumber(badge, numeralStyle, lang)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="space-y-2 border-t border-separator/50 pt-4">
                <button
                  type="button"
                  onClick={() => pushRoute({ name: "tenant" })}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-cell bg-fill px-3 text-sub font-medium text-label"
                >
                  <Building2 size={16} aria-hidden />
                  <span>{lang === "en" ? "Workspace & Members" : "المساحة والأعضاء"}</span>
                </button>
                {isSuperAdmin ? (
                  <button
                    type="button"
                    onClick={() => pushRoute({ name: "admin" })}
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-cell bg-tint/12 px-3 text-sub font-semibold text-tint"
                  >
                    <Crown size={16} aria-hidden />
                    <span>{lang === "en" ? "Super-Admin" : "لوحة المنصة"}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSheet({ kind: "search" })}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-cell bg-fill px-3 text-sub font-medium text-label"
                >
                  <Search size={16} aria-hidden />
                  <span>{t("search")}</span>
                </button>
                {canWrite ? (
                  <>
                    <button
                      type="button"
                      onClick={() => guardedOpenSheet({ kind: "csv-import" })}
                      className="flex min-h-10 w-full items-center gap-2.5 rounded-cell bg-fill px-3 text-sub font-medium text-label"
                    >
                      <FileSpreadsheet size={16} aria-hidden />
                      <span>{t("importCsv")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={openAdd}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-pill bg-tint px-4 text-sub font-semibold text-on-tint shadow-sm"
                    >
                      <Plus size={17} aria-hidden />
                      <span>{t("add")}</span>
                    </button>
                  </>
                ) : null}
              </div>
            </aside>
          ) : null}

          <div
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
            onScroll={(e) => setCompact(e.currentTarget.scrollTop > 28)}
          >
            {locked ? (
              <Suspense fallback={<ScreenFallback />}>
                <LockScreen
                  onUnlock={() => {
                    lastActiveRef.current = Date.now();
                    setUnlocked(true);
                  }}
                />
              </Suspense>
            ) : (
              <>
                <header className={cn("sticky top-0 z-20 pt-safe", compact && "glass")}>
                  <div className="flex h-14 items-center justify-between px-2 lg:px-4">
                    <div className="flex min-w-11 items-center">
                      {route.name !== "main" ? (
                        <button
                          type="button"
                          className="flex min-h-11 min-w-11 items-center justify-center text-tint"
                          onClick={back}
                          aria-label={t("back")}
                        >
                          <BackChevron size={26} strokeWidth={2} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-11 min-w-11 items-center justify-center text-label-2 lg:hidden"
                          onClick={() => setSheet({ kind: "search" })}
                          aria-label={t("search")}
                        >
                          <Search size={19} strokeWidth={2} />
                        </button>
                      )}
                    </div>

                    {route.name === "main" && !compact && activeTenant ? (
                      <button
                        type="button"
                        onClick={() => setSheet({ kind: "workspace-switcher" })}
                        className="flex max-w-[60%] items-center gap-1.5 rounded-pill bg-fill/90 px-3 py-1.5 text-caption font-semibold text-label lg:hidden"
                      >
                        {!isOnline ? (
                          <CloudOff size={13} className="text-warn shrink-0" />
                        ) : syncStatus === "syncing" ? (
                          <RefreshCw size={13} className="animate-spin text-tint shrink-0" />
                        ) : activeTenant.mode === "cloud" ? (
                          <Cloud size={13} className="text-tint shrink-0" />
                        ) : (
                          <HardDrive size={13} className="text-warn shrink-0" />
                        )}
                        <span className="truncate">{activeTenant.name}</span>
                        <ChevronDown size={13} className="text-label-2 shrink-0" />
                      </button>
                    ) : (
                      <p className="truncate text-headline font-semibold">
                        {compact || route.name !== "main" ? title : ""}
                      </p>
                    )}

                    <div className="flex min-w-11 justify-end items-center gap-1">
                      {activeTenant?.mode === "cloud" && pendingOpsCount > 0 && isOnline ? (
                        <button
                          type="button"
                          onClick={() => void syncNow()}
                          className="hidden sm:inline-flex items-center gap-1 rounded-pill bg-fill px-2.5 py-1 text-caption font-semibold text-tint"
                          title={lang === "en" ? "Sync pending changes" : "مزامنة التغييرات"}
                        >
                          <RefreshCw size={12} className={syncStatus === "syncing" ? "animate-spin" : ""} />
                          <span>{pendingOpsCount}</span>
                        </button>
                      ) : null}

                      {showAdd ? (
                        <PillButton onClick={openAdd}>{t("add")}</PillButton>
                      ) : route.name === "person" && canWrite ? (
                        <button
                          type="button"
                          className="min-h-11 px-3 text-body text-tint"
                          onClick={() => guardedOpenSheet({ kind: "person", id: route.id })}
                        >
                          {t("edit")}
                        </button>
                      ) : route.name === "goal" && canWrite ? (
                        <button
                          type="button"
                          className="min-h-11 px-3 text-body text-tint"
                          onClick={() => guardedOpenSheet({ kind: "goal", id: route.id })}
                        >
                          {t("edit")}
                        </button>
                      ) : (
                        <span className="min-w-11" />
                      )}
                    </div>
                  </div>

                  {/* Multi-Tenant Read-Only / Rejected / Migration Banners */}
                  {!canWrite ? (
                    <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-cell bg-warn/15 px-3 py-2 text-caption font-semibold text-label">
                      <span className="flex items-center gap-1.5">
                        <Lock size={14} className="text-warn shrink-0" />
                        {activeTenant?.subscriptionStatus === "suspended"
                          ? lang === "en"
                            ? "Workspace is suspended — view & export only"
                            : "هذه المساحة موقوفة مؤقتًا — العرض والتصدير متاحان فقط"
                          : lang === "en"
                            ? "Viewer access — read-only workspace"
                            : "صلاحيتك في هذه المساحة «مشاهد» (للقراءة فقط)"}
                      </span>
                    </div>
                  ) : null}

                  {rejectedSyncItems.length > 0 ? (
                    <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-cell bg-expense/15 px-3 py-2 text-caption text-label">
                      <button
                        type="button"
                        onClick={() => pushRoute({ name: "tenant" })}
                        className="flex items-center gap-1.5 font-semibold text-expense text-start"
                      >
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>
                          {lang === "en"
                            ? `${rejectedSyncItems.length} offline edits rejected by server permissions`
                            : `تم رفض ${rejectedSyncItems.length} تعديلات أوفلاين من الخادم`}
                        </span>
                      </button>
                      <button type="button" onClick={dismissRejectedSync} className="underline shrink-0">
                        {lang === "en" ? "Dismiss" : "إخفاء"}
                      </button>
                    </div>
                  ) : null}

                  {migratedLegacyNotice ? (
                    <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-cell bg-tint/12 px-3 py-2 text-caption text-label">
                      <span>
                        {lang === "en"
                          ? "Previous local ledger was migrated into this personal workspace."
                          : "تم نقل بياناتك المحلية السابقة تلقائيًا إلى مساحتك الشخصية."}
                      </span>
                      <button type="button" onClick={dismissMigratedNotice} className="font-semibold text-tint underline">
                        {lang === "en" ? "OK" : "حسناً"}
                      </button>
                    </div>
                  ) : null}
                </header>

                <ErrorBoundary
                  key={`eb:${activeTenant?.id}:${tab}:${route.name}:${"id" in route ? route.id : ""}`}
                  scopeName="screen"
                  routeName={route.name}
                  tabName={tab}
                  onGoHome={() => setTab("home")}
                >
                  <Suspense fallback={<ScreenFallback />}>
                    <MotionScreen motionKey={`${activeTenant?.id}:${tab}:${route.name}:${"id" in route ? route.id : ""}`}>
                      {route.name === "person" ? (
                        <PersonScreen id={route.id} />
                      ) : route.name === "debt" ? (
                        <DebtScreen id={route.id} />
                      ) : route.name === "report" ? (
                        <ReportScreen />
                      ) : route.name === "goals" ? (
                        <GoalsScreen />
                      ) : route.name === "goal" ? (
                        <GoalScreen id={route.id} />
                      ) : route.name === "wallets" ? (
                        <WalletsScreen />
                      ) : route.name === "recurring" ? (
                        <RecurringScreen />
                      ) : route.name === "notifications" ? (
                        <NotificationsScreen />
                      ) : route.name === "drive" ? (
                        <DriveSyncScreen />
                      ) : route.name === "security" ? (
                        <SecurityScreen />
                      ) : route.name === "tenant" ? (
                        <TenantSettingsScreen />
                      ) : route.name === "admin" ? (
                        <SuperAdminScreen />
                      ) : tab === "home" ? (
                        <HomeScreen />
                      ) : tab === "ledger" ? (
                        <LedgerScreen />
                      ) : tab === "debts" ? (
                        <DebtsScreen />
                      ) : tab === "people" ? (
                        <PeopleScreen />
                      ) : (
                        <MoreScreen />
                      )}
                    </MotionScreen>
                  </Suspense>
                </ErrorBoundary>
                <div className={route.name === "main" ? "h-28 lg:h-10" : "h-10"} />
              </>
            )}
          </div>

          {route.name === "main" && !locked ? (
            <nav
              className="glass tab-bar absolute inset-x-3 z-30 flex max-w-[calc(100%-1.5rem)] min-w-0 items-stretch rounded-pill px-1 py-1 lg:hidden"
              aria-label={lang === "en" ? "Sections" : "الأقسام"}
            >
              {tabs.map((item) => {
                const on = tab === item.id;
                const Icon = item.icon;
                const badge = item.id === "debts" ? overdue : 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={on ? "page" : undefined}
                    aria-label={badge ? `${item.label} (${badge})` : item.label}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-pill",
                      on ? "text-tint" : "text-label-2",
                    )}
                  >
                    <span className="relative">
                      <Icon
                        size={22}
                        strokeWidth={on ? 2.2 : 1.8}
                        fill={on && item.id !== "more" ? "currentColor" : "none"}
                        aria-hidden
                      />
                      {badge > 0 ? (
                        <span className="absolute -top-1.5 -start-2 flex h-4 min-w-4 items-center justify-center rounded-pill bg-expense px-1 text-caption2 text-on-tint">
                          {formatNumber(badge, numeralStyle, lang)}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap text-caption2">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          ) : null}

          {backgroundMasked ? (
            <div className="glass absolute inset-0 z-50 flex flex-col items-center justify-center px-6 text-center">
              <p className="text-title1 font-bold text-label">{t("appName")}</p>
              <p className="mt-2 text-sub text-label-2">{lang === "en" ? "Privacy Active" : "الخصوصية مفعّلة"}</p>
            </div>
          ) : null}

          <ErrorBoundary scopeName="sheet" routeName={sheet?.kind} onGoHome={() => setSheet(null)}>
            <Suspense fallback={<SheetFallback />}>
              {sheet?.kind === "workspace-switcher" ? (
                <WorkspaceSwitcherSheet open={true} onClose={() => setSheet(null)} />
              ) : null}
              {sheet?.kind === "txn" ? (
                <TxnForm
                  key={`${sheet.id ?? "new-tx"}-${sheet.prefill?.kind ?? "none"}-${sheet.prefill?.note ?? ""}`}
                  id={sheet.id}
                  prefill={sheet.prefill}
                />
              ) : null}
              {sheet?.kind === "person" ? <PersonForm key={sheet.id ?? "new-person"} id={sheet.id} /> : null}
              {sheet?.kind === "debt" ? <DebtForm key={sheet.id ?? "new-debt"} id={sheet.id} /> : null}
              {sheet?.kind === "pay" ? <PayForm key={sheet.debtId} debtId={sheet.debtId} /> : null}
              {sheet?.kind === "reset" ? <ResetForm /> : null}
              {sheet?.kind === "transfer" ? <TransferForm /> : null}
              {sheet?.kind === "wallet" ? <WalletForm key={sheet.id ?? "new-wallet"} id={sheet.id} /> : null}
              {sheet?.kind === "recurring" ? <RecurringForm key={sheet.id ?? "new-rec"} id={sheet.id} /> : null}
              {sheet?.kind === "split" ? <SplitForm /> : null}
              {sheet?.kind === "goal" ? <GoalForm key={sheet.id ?? "new-goal"} id={sheet.id} /> : null}
              {sheet?.kind === "goal-move" ? (
                <GoalMoveForm
                  key={`${sheet.goalId}-${sheet.withdraw ? "out" : "in"}`}
                  goalId={sheet.goalId}
                  withdraw={sheet.withdraw}
                />
              ) : null}
              {sheet?.kind === "pin" ? <PinForm /> : null}
              {sheet?.kind === "search" ? <UnifiedSearchSheet /> : null}
              {sheet?.kind === "csv-import" ? <CsvImportSheet /> : null}
              {sheet?.kind === "design" ? <DesignStudioSheet /> : null}
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </MizanContext.Provider>
  );
}

function heading(
  tab: Tab,
  route: Route,
  people: { id: string; name: string }[],
  debts: { id: string; title: string }[],
  goals: { id: string; name: string }[],
  lang: "ar" | "en",
) {
  if (route.name === "person") return people.find((p) => p.id === route.id)?.name ?? (lang === "en" ? "Person" : "شخص");
  if (route.name === "debt") return debts.find((d) => d.id === route.id)?.title ?? (lang === "en" ? "Debt" : "دين");
  if (route.name === "report") return lang === "en" ? "Report" : "التقرير";
  if (route.name === "goals") return lang === "en" ? "Goals" : "الأهداف";
  if (route.name === "goal") return goals.find((g) => g.id === route.id)?.name ?? (lang === "en" ? "Goal" : "هدف");
  if (route.name === "wallets") return lang === "en" ? "Wallets" : "المحافظ";
  if (route.name === "recurring") return lang === "en" ? "Recurring" : "المتكرر";
  if (route.name === "notifications") return lang === "en" ? "Notifications & Tasks" : "الإشعارات والمهام";
  if (route.name === "drive") return lang === "en" ? "Google Drive Sync" : "مزامنة Google Drive";
  if (route.name === "security") return lang === "en" ? "Security & Privacy" : "الأمان والخصوصية";
  if (route.name === "tenant") return lang === "en" ? "Workspace & Members" : "المساحة والأعضاء";
  if (route.name === "admin") return lang === "en" ? "Platform Admin" : "لوحة المنصة";
  if (tab === "home") return lang === "en" ? "Today" : "اليوم";
  if (tab === "ledger") return lang === "en" ? "Ledger" : "السجل";
  if (tab === "debts") return lang === "en" ? "Debts" : "الديون";
  if (tab === "people") return lang === "en" ? "People" : "الناس";
  return lang === "en" ? "More" : "المزيد";
}
