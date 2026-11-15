import { ChevronRight, Ellipsis, House, Scale, Search, Users, Wallet } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  MizanContext,
  type DebtTabFilter,
  type Route,
  type SheetState,
  type Tab,
} from "@/components/finance/context";
import { DriveSyncScreen } from "@/components/finance/drive-sync-screen";
import {
  GoalForm,
  GoalMoveForm,
  PinForm,
  RecurringForm,
  SplitForm,
  TransferForm,
  WalletForm,
} from "@/components/finance/feature-forms";
import {
  GoalScreen,
  GoalsScreen,
  LockScreen,
  RecurringScreen,
  ReportScreen,
  WalletsScreen,
} from "@/components/finance/features";
import { DebtForm, PayForm, PersonForm, ResetForm, TxnForm } from "@/components/finance/forms";
import { MotionScreen } from "@/components/finance/gsap-motion";
import { NotificationsScreen } from "@/components/finance/notifications-screen";
import {
  DebtScreen,
  DebtsScreen,
  HomeScreen,
  LedgerScreen,
  MoreScreen,
  PeopleScreen,
  PersonScreen,
} from "@/components/finance/screens";
import { UnifiedSearchSheet } from "@/components/finance/search-sheet";
import { SecurityScreen } from "@/components/finance/security-screen";
import { PillButton } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { currentMonth, debtTotals, shiftMonthKey } from "@/lib/finance/logic";
import { readPinHash, writePinHash } from "@/lib/finance/pin";
import {
  applyPrivacyScreenFlag,
  loadSecuritySettings,
  shouldAutoLock,
  useSecuritySettings,
} from "@/lib/finance/security";
import {
  getLocalUpdatedAt,
  getPendingCloudSync,
  hydrateFinance,
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

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: "home", label: "اليوم", icon: House },
  { id: "ledger", label: "السجل", icon: Wallet },
  { id: "debts", label: "الديون", icon: Scale },
  { id: "people", label: "الناس", icon: Users },
  { id: "more", label: "أكثر", icon: Ellipsis },
];

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MizanRoot() {
  return <App />;
}

function sameRoute(a: Route, b: Route) {
  if (a.name !== b.name) return false;
  const aid = "id" in a ? a.id : "";
  const bid = "id" in b ? b.id : "";
  return aid === bid;
}

function App() {
  const [tab, setTabState] = useState<Tab>("home");
  const [month, setMonth] = useState(currentMonth);
  const [stack, setStack] = useState<Route[]>([{ name: "main" }]);
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
  const security = useSecuritySettings();

  const route = stack[stack.length - 1] ?? { name: "main" };

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
    hydrateFinance();
    void scheduleAllTaskNotifications();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "expense") setSheet({ kind: "txn", prefill: { kind: "expense" } });
      else if (action === "income") setSheet({ kind: "txn", prefill: { kind: "income" } });
      else if (action === "debt") setSheet({ kind: "debt" });
      else if (action === "search") setSheet({ kind: "search" });
    }
  }, []);

  // Listen to native Android notification action buttons ("تم الدفع" / "تأجيل يوم")
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void registerNotificationActionListener((action) => {
      const extra = (action.notification.extra ?? {}) as { taskId?: string };
      const taskId = extra.taskId;
      if (!taskId) return;
      const task = loadScheduledTasks().find((t) => t.id === taskId);
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

  // Auto-lock + privacy blur shield when app goes to background or exceeds inactivity timeout
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

  // Automatic Google Drive sync when store changes or when coming back online
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

  const title = heading(tab, route, people, debts, goals);

  function openAdd() {
    if (tab === "debts") setSheet({ kind: "debt" });
    else if (tab === "people") setSheet({ kind: "person" });
    else if (tab === "home" || tab === "ledger") setSheet({ kind: "txn" });
  }

  const showAdd = route.name === "main" && tab !== "more";
  const locked = Boolean(pinHash) && !unlocked;

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
        openDebtsFiltered,
        openLedgerFiltered,
        debtFilter,
        setDebtFilter,
        ledgerCategoryFilter,
        setLedgerCategoryFilter,
        back,
        sheet,
        openSheet: setSheet,
        closeSheet: () => setSheet(null),
        query,
        setQuery,
        frame,
        pinHash,
        setPinHash,
      }}
    >
      <div className="fixed inset-0 flex min-w-0 max-w-full justify-center overflow-hidden bg-surround text-label">
        <div
          ref={setFrame}
          className="relative flex h-full min-w-0 w-full max-w-full flex-col overflow-hidden bg-grouped md:max-w-md"
        >
          <div
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
            onScroll={(e) => setCompact(e.currentTarget.scrollTop > 28)}
          >
            {locked ? (
              <LockScreen
                onUnlock={() => {
                  lastActiveRef.current = Date.now();
                  setUnlocked(true);
                }}
              />
            ) : (
              <>
                <header className={cn("sticky top-0 z-20 pt-safe", compact && "glass")}>
                  <div className="flex h-14 items-center justify-between px-2">
                    <div className="flex min-w-11 items-center">
                      {route.name !== "main" ? (
                        <button
                          type="button"
                          className="flex min-h-11 min-w-11 items-center justify-center text-tint"
                          onClick={back}
                          aria-label="رجوع"
                        >
                          <ChevronRight size={26} strokeWidth={2} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-11 min-w-11 items-center justify-center text-label-2"
                          onClick={() => setSheet({ kind: "search" })}
                          aria-label="بحث شامل"
                        >
                          <Search size={19} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                    <p className="truncate text-headline font-semibold">
                      {compact || route.name !== "main" ? title : ""}
                    </p>
                    <div className="flex min-w-11 justify-end">
                      {showAdd ? (
                        <PillButton onClick={openAdd}>إضافة</PillButton>
                      ) : route.name === "person" ? (
                        <button
                          type="button"
                          className="min-h-11 px-3 text-body text-tint"
                          onClick={() => setSheet({ kind: "person", id: route.id })}
                        >
                          تعديل
                        </button>
                      ) : route.name === "goal" ? (
                        <button
                          type="button"
                          className="min-h-11 px-3 text-body text-tint"
                          onClick={() => setSheet({ kind: "goal", id: route.id })}
                        >
                          تعديل
                        </button>
                      ) : (
                        <span className="min-w-11" />
                      )}
                    </div>
                  </div>
                </header>

                <MotionScreen motionKey={`${tab}:${route.name}:${"id" in route ? route.id : ""}`}>
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
                <div className={route.name === "main" ? "h-28" : "h-10"} />
              </>
            )}
          </div>

          {route.name === "main" && !locked ? (
            <nav
              className="glass tab-bar absolute inset-x-3 z-30 flex max-w-[calc(100%-1.5rem)] min-w-0 items-stretch rounded-pill px-1 py-1"
              aria-label="الأقسام"
            >
              {TABS.map((item) => {
                const on = tab === item.id;
                const Icon = item.icon;
                const badge = item.id === "debts" ? overdue : 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={on ? "page" : undefined}
                    aria-label={badge ? `${item.label}، ${badge} متأخرة` : item.label}
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
                          {badge}
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
              <p className="text-title1 font-bold text-label">ميزان</p>
              <p className="mt-2 text-sub text-label-2">الخصوصية مفعّلة</p>
            </div>
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
          <Toaster position="top-center" dir="rtl" offset={12} />
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
) {
  if (route.name === "person") return people.find((p) => p.id === route.id)?.name ?? "شخص";
  if (route.name === "debt") return debts.find((d) => d.id === route.id)?.title ?? "دين";
  if (route.name === "report") return "التقرير";
  if (route.name === "goals") return "الأهداف";
  if (route.name === "goal") return goals.find((g) => g.id === route.id)?.name ?? "هدف";
  if (route.name === "wallets") return "المحافظ";
  if (route.name === "recurring") return "المتكرر";
  if (route.name === "notifications") return "الإشعارات والمهام";
  if (route.name === "drive") return "مزامنة Google Drive";
  if (route.name === "security") return "الأمان والخصوصية";
  if (tab === "home") return "اليوم";
  if (tab === "ledger") return "السجل";
  if (tab === "debts") return "الديون";
  if (tab === "people") return "الناس";
  return "المزيد";
}
