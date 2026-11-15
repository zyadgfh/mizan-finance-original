import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { defaultExchangeRatesFor, defaultWallets } from "../finance/logic.ts";
import { configureReceiptSyncScope, flushPendingReceiptSync } from "../finance/receipts.ts";
import { seedData } from "../finance/seed.ts";
import {
  applySyncedTenantData,
  asData,
  clearFinanceTenantScope,
  hydrateTenantFinance,
  pickFinanceData,
  useFinance,
} from "../finance/store.ts";
import type { Currency, Data } from "../finance/types.ts";
import { getSupabaseClient } from "../supabase/client.ts";
import {
  activateTenantPlan,
  createCloudWorkspace,
  fetchMyWorkspaceBundle,
  queueOutboxOperations,
  redeemTenantInvite,
  signOutSupabase,
  syncTenantWithSupabase,
  updateCloudWorkspaceSettings,
  userFromAuth,
} from "./api.ts";
import {
  loadActiveTenantId,
  loadCachedSessionBundle,
  loadLegacyMizanV1Raw,
  loadLocalWorkspaces,
  loadTenantOutbox,
  markLegacyMizanV1Migrated,
  saveActiveTenantId,
  saveCachedSessionBundle,
  saveLocalWorkspaces,
  snapshotToOutboxOps,
  wipeAllTenantCachesOnSignOut,
  wipeTenantCache,
} from "./storage.ts";
import {
  canEditWorkspace,
  type PlanCode,
  type SubscriptionPlan,
  type SyncRejectedItem,
  type SyncStatus,
  type TenantKind,
  type TenantSummary,
  type TenantUser,
} from "./types.ts";

export const PENDING_INVITE_KEY = "mizan.pendingInvite.v1";

export type InitialTestSession = {
  user: TenantUser;
  workspaces: TenantSummary[];
  activeTenantId?: string;
  plans?: SubscriptionPlan[];
  isSuperAdmin?: boolean;
};

export type TenantContextValue = {
  authStatus: "loading" | "authenticated" | "unauthenticated";
  user: TenantUser | null;
  isSuperAdmin: boolean;
  workspaces: TenantSummary[];
  plans: SubscriptionPlan[];
  activeTenant: TenantSummary | null;
  canWrite: boolean;
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingOpsCount: number;
  rejectedSyncItems: SyncRejectedItem[];
  lastSyncedAt: number | null;
  migratedLegacyNotice: boolean;
  passwordRecoveryPending: boolean;
  clearPasswordRecovery: () => void;
  dismissMigratedNotice: () => void;
  dismissRejectedSync: () => void;
  switchTenant: (tenantId: string) => void;
  switchTenantBySlug: (slug: string) => boolean;
  refreshWorkspaces: () => Promise<void>;
  syncNow: () => Promise<void>;
  createWorkspace: (input: {
    name: string;
    slug?: string;
    kind: TenantKind;
    baseCurrency: Currency;
    mode: "cloud" | "local";
    planCode?: PlanCode;
  }) => Promise<TenantSummary>;
  promoteLocalWorkspace: (localTenantId: string) => Promise<TenantSummary>;
  updateActiveWorkspace: (patch: Partial<{ name: string; slug: string; kind: TenantKind; baseCurrency: Currency }>) => Promise<void>;
  activatePlan: (planCode: PlanCode) => Promise<void>;
  acceptInviteCode: (code: string) => Promise<TenantSummary | null>;
  signOut: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside <TenantProvider>");
  return ctx;
}

export function useOptionalTenant(): TenantContextValue | null {
  return useContext(TenantContext);
}

const DEFAULT_PLANS: SubscriptionPlan[] = [
  { code: "monthly", nameAr: "الخطة الشهرية", nameEn: "Monthly Plan", priceEgp: 19, billingInterval: "month", trialDays: 14, isActive: true },
  { code: "yearly", nameAr: "الخطة السنوية", nameEn: "Yearly Plan", priceEgp: 149, billingInterval: "year", trialDays: 14, isActive: true },
];

function emptyWorkspaceData(currency: Currency, openingBalance = 0): Data {
  const fresh = seedData();
  return {
    ...fresh,
    txns: [],
    people: [],
    debts: [],
    payments: [],
    budgets: [],
    openingBalance,
    currency,
    exchangeRates: defaultExchangeRatesFor(currency),
    phoneCountryCode: undefined,
    demo: false,
    wallets: defaultWallets(openingBalance),
    transfers: [],
    recurring: [],
    goals: [],
    goalMoves: [],
    debtLogs: [],
  };
}

export function TenantProvider({
  children,
  requestedSlug,
  requestedInviteCode,
  initialSession,
}: {
  children: ReactNode;
  requestedSlug?: string;
  requestedInviteCode?: string;
  initialSession?: InitialTestSession;
}) {
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">(
    initialSession ? "authenticated" : "loading",
  );
  const [user, setUser] = useState<TenantUser | null>(initialSession?.user ?? null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(Boolean(initialSession?.isSuperAdmin));
  const [workspaces, setWorkspaces] = useState<TenantSummary[]>(initialSession?.workspaces ?? []);
  const [plans, setPlans] = useState<SubscriptionPlan[]>(initialSession?.plans ?? DEFAULT_PLANS);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(
    initialSession?.activeTenantId ?? initialSession?.workspaces[0]?.id ?? null,
  );
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [rejectedSyncItems, setRejectedSyncItems] = useState<SyncRejectedItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [migratedLegacyNotice, setMigratedLegacyNotice] = useState(false);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);

  const syncTimerRef = useRef<number | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (requestedInviteCode && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_INVITE_KEY, requestedInviteCode.trim().toUpperCase());
    }
  }, [requestedInviteCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setIsOnline(true);
    const onOffline = () => {
      setIsOnline(false);
      setSyncStatus("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const activeTenant = useMemo(() => {
    if (!workspaces.length) return null;
    if (requestedSlug) {
      const bySlug = workspaces.find((w) => w.slug.toLowerCase() === requestedSlug.toLowerCase());
      if (bySlug) return bySlug;
    }
    if (activeTenantId) {
      const match = workspaces.find((w) => w.id === activeTenantId);
      if (match) return match;
    }
    return workspaces[0] ?? null;
  }, [workspaces, activeTenantId, requestedSlug]);

  const canWrite = useMemo(() => canEditWorkspace(activeTenant), [activeTenant]);

  const syncSpecificTenant = useCallback(
    async (tenant: TenantSummary | null) => {
      if (!tenant || tenant.mode !== "cloud" || initialSession) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setSyncStatus("offline");
        return;
      }
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncStatus("syncing");
      try {
        const currentData = pickFinanceData(useFinance.getState());
        const res = await syncTenantWithSupabase(tenant.id, currentData, localStorage);
        await flushPendingReceiptSync(tenant.id);
        applySyncedTenantData(tenant.id, res.mergedData);
        setPendingOpsCount(res.remainingOutboxCount);
        setLastSyncedAt(Date.now());
        setSyncStatus("idle");
        if (res.rejected.length > 0) {
          setRejectedSyncItems((prev) => [...res.rejected, ...prev].slice(0, 20));
          toast.error(`تم رفض ${res.rejected.length} عملية أثناء المزامنة بسبب الصلاحية أو حالة الاشتراك`);
        }
      } catch {
        setSyncStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      } finally {
        syncingRef.current = false;
      }
    },
    [initialSession],
  );

  const scheduleSync = useCallback(
    (tenant: TenantSummary | null) => {
      if (!tenant || tenant.mode !== "cloud" || initialSession) return;
      if (typeof window === "undefined") return;
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => {
        void syncSpecificTenant(tenant);
      }, 900);
    },
    [initialSession, syncSpecificTenant],
  );

  const activeTenantKey = activeTenant?.id ?? null;
  const activeTenantMode = activeTenant?.mode ?? null;

  // Hydrate isolated tenant finance store ONLY when active user/tenant changes
  useEffect(() => {
    if (authStatus !== "authenticated" || !user || !activeTenant) return;
    saveActiveTenantId(activeTenant.id);
    const editable = canEditWorkspace(activeTenant);
    configureReceiptSyncScope({
      tenantId: activeTenant.id,
      mode: activeTenant.mode,
      canWrite: editable,
    });

    const fallback = emptyWorkspaceData(activeTenant.baseCurrency, activeTenant.openingBalance ?? 0);
    hydrateTenantFinance(
      {
        tenantId: activeTenant.id,
        mode: activeTenant.mode,
        actorId: user.id,
        actorName: user.displayName,
        canWrite: editable,
        onOpsQueued: () => {
          if (typeof localStorage !== "undefined" && activeTenant.mode === "cloud") {
            setPendingOpsCount(loadTenantOutbox(activeTenant.id, localStorage).length);
            scheduleSync(activeTenant);
          }
        },
      },
      fallback,
    );

    if (typeof localStorage !== "undefined" && activeTenant.mode === "cloud") {
      setPendingOpsCount(loadTenantOutbox(activeTenant.id, localStorage).length);
    } else {
      setPendingOpsCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, user?.id, activeTenantKey, activeTenant?.role, activeTenant?.subscriptionStatus]);

  // Trigger sync on tenant switch or reconnect when online
  useEffect(() => {
    if (authStatus !== "authenticated" || !activeTenant || activeTenantMode !== "cloud") return;
    if (isOnline && !initialSession) {
      void syncSpecificTenant(activeTenant);
    }
  }, [authStatus, activeTenantKey, activeTenantMode, isOnline, initialSession, activeTenant, syncSpecificTenant]);

  const hydrateAuthenticatedUser = useCallback(
    async (authUser: TenantUser) => {
      try {
        const bundle = await fetchMyWorkspaceBundle(authUser);
        let cloudList = [...bundle.workspaces];

        // Auto-redeem any invite code queued before login
        const pendingInvite =
          typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PENDING_INVITE_KEY) : null;
        if (pendingInvite) {
          try {
            await redeemTenantInvite(pendingInvite);
            sessionStorage.removeItem(PENDING_INVITE_KEY);
            const refreshed = await fetchMyWorkspaceBundle(authUser);
            cloudList = [...refreshed.workspaces];
          } catch (err) {
            sessionStorage.removeItem(PENDING_INVITE_KEY);
            toast.error(err instanceof Error ? err.message : "تعذّر قبول الدعوة");
          }
        }

        // First cloud workspace provisioning + automatic legacy mizan.v1 migration
        const legacyRaw = typeof localStorage !== "undefined" ? loadLegacyMizanV1Raw(localStorage) : null;
        const legacyParsed = legacyRaw ? asData(legacyRaw) : null;

        if (cloudList.length === 0) {
          const defaultWs = await createCloudWorkspace({
            name: "دفتر ميزان الشخصي",
            kind: "personal",
            baseCurrency: legacyParsed?.currency ?? "EGP",
            planCode: "monthly",
          });
          cloudList = [defaultWs];
        }

        if (legacyParsed && cloudList.length > 0 && typeof localStorage !== "undefined") {
          const targetWs = cloudList.find((w) => w.role === "owner") ?? cloudList[0];
          const ops = snapshotToOutboxOps(legacyParsed, Date.now());
          localStorage.setItem(`mizan.tenant.${targetWs.id}.v1`, JSON.stringify(pickFinanceData(legacyParsed)));
          queueOutboxOperations(targetWs.id, ops, localStorage);
          markLegacyMizanV1Migrated(targetWs.id, localStorage);
          setMigratedLegacyNotice(true);
        } else if (legacyRaw && typeof localStorage !== "undefined") {
          markLegacyMizanV1Migrated(cloudList[0]?.id ?? "migrated", localStorage);
        }

        const localOnly = typeof localStorage !== "undefined" ? loadLocalWorkspaces(authUser.id, localStorage) : [];
        const allWorkspaces = [...cloudList, ...localOnly];
        const finalPlans = bundle.plans.length ? bundle.plans : DEFAULT_PLANS;

        setUser(bundle.user);
        setIsSuperAdmin(bundle.isSuperAdmin);
        setWorkspaces(allWorkspaces);
        setPlans(finalPlans);
        setAuthStatus("authenticated");

        saveCachedSessionBundle({
          user: bundle.user,
          workspaces: cloudList,
          plans: finalPlans,
          isSuperAdmin: bundle.isSuperAdmin,
          cachedAt: Date.now(),
        });

        const storedActiveId = loadActiveTenantId();
        const preferred =
          (requestedSlug && allWorkspaces.find((w) => w.slug.toLowerCase() === requestedSlug.toLowerCase())?.id) ||
          (storedActiveId && allWorkspaces.find((w) => w.id === storedActiveId)?.id) ||
          allWorkspaces[0]?.id ||
          null;
        setActiveTenantId(preferred);
      } catch {
        // Offline / network fallback from encrypted/local session cache if previously signed in
        const cached = loadCachedSessionBundle();
        if (cached && cached.user.id === authUser.id) {
          const localOnly = loadLocalWorkspaces(authUser.id);
          const allWorkspaces = [...cached.workspaces, ...localOnly];
          setUser(cached.user);
          setIsSuperAdmin(cached.isSuperAdmin);
          setWorkspaces(allWorkspaces);
          setPlans(cached.plans.length ? cached.plans : DEFAULT_PLANS);
          setAuthStatus("authenticated");
          setSyncStatus("offline");
          const storedActiveId = loadActiveTenantId();
          setActiveTenantId(
            (storedActiveId && allWorkspaces.find((w) => w.id === storedActiveId)?.id) ||
              allWorkspaces[0]?.id ||
              null,
          );
          return;
        }
        setAuthStatus("unauthenticated");
      }
    },
    [requestedSlug],
  );

  // Initialize Supabase Auth listener (skipped when initialSession test fixture is supplied)
  useEffect(() => {
    if (initialSession) return;
    let mounted = true;
    const sb = getSupabaseClient();

    void sb.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (data.session?.user) {
        await hydrateAuthenticatedUser(userFromAuth(data.session.user));
      } else {
        const cached = loadCachedSessionBundle();
        if (cached && typeof navigator !== "undefined" && navigator.onLine === false) {
          const localOnly = loadLocalWorkspaces(cached.user.id);
          setUser(cached.user);
          setIsSuperAdmin(cached.isSuperAdmin);
          setWorkspaces([...cached.workspaces, ...localOnly]);
          setPlans(cached.plans.length ? cached.plans : DEFAULT_PLANS);
          setActiveTenantId(loadActiveTenantId() ?? cached.workspaces[0]?.id ?? null);
          setAuthStatus("authenticated");
          setSyncStatus("offline");
        } else {
          setAuthStatus("unauthenticated");
        }
      }
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryPending(true);
      }
      if (event === "SIGNED_OUT") {
        configureReceiptSyncScope({ tenantId: null, mode: "local", canWrite: true });
        clearFinanceTenantScope();
        wipeAllTenantCachesOnSignOut();
        setUser(null);
        setIsSuperAdmin(false);
        setWorkspaces([]);
        setActiveTenantId(null);
        setAuthStatus("unauthenticated");
        return;
      }
      if ((event === "SIGNED_IN" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY") && session?.user) {
        void hydrateAuthenticatedUser(userFromAuth(session.user));
      }
    });

    // Native Android / Capacitor deep-link handler (com.mizan.finance:// or https://...)
    const handleDeepLinkUrl = async (rawUrl: string) => {
      if (!rawUrl) return;
      try {
        const parsed = new URL(rawUrl);
        const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token") ?? parsed.searchParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token") ?? parsed.searchParams.get("refresh_token");
        const linkType = hashParams.get("type") ?? parsed.searchParams.get("type");

        if (accessToken && refreshToken) {
          await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (linkType === "recovery") {
            setPasswordRecoveryPending(true);
          }
        }

        const fullPath = parsed.host ? `/${parsed.host}${parsed.pathname}` : parsed.pathname;
        const inviteMatch = fullPath.match(/\/invite\/([A-Za-z0-9-]+)/);
        const inviteCode = parsed.searchParams.get("invite")?.trim() || inviteMatch?.[1];
        if (inviteCode) {
          const normalized = inviteCode.toUpperCase();
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(PENDING_INVITE_KEY, normalized);
          }
          const { data: s } = await sb.auth.getSession();
          if (s.session?.user) {
            try {
              const redeemed = await redeemTenantInvite(normalized);
              sessionStorage.removeItem(PENDING_INVITE_KEY);
              await hydrateAuthenticatedUser(userFromAuth(s.session.user));
              setActiveTenantId(redeemed.tenantId);
              saveActiveTenantId(redeemed.tenantId);
              toast.success(`تم الانضمام إلى ${redeemed.name}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "تعذّر قبول الدعوة");
            }
          }
        }
      } catch {
        /* ignore malformed deep link */
      }
    };

    const onNativeDeepLink = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      if (typeof detail === "string") void handleDeepLinkUrl(detail);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("mizan:deeplink", onNativeDeepLink);
      const nativeBridge = (window as unknown as { MizanNative?: { consumeLaunchUrl?: () => string } }).MizanNative;
      const launchUrl = nativeBridge?.consumeLaunchUrl?.();
      if (launchUrl) void handleDeepLinkUrl(launchUrl);
    }

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("mizan:deeplink", onNativeDeepLink);
      }
    };
  }, [initialSession, hydrateAuthenticatedUser]);

  const refreshWorkspaces = useCallback(async () => {
    if (!user || initialSession) return;
    const prevIds = new Set(workspaces.filter((w) => w.mode === "cloud").map((w) => w.id));
    await hydrateAuthenticatedUser(user);
    // Clean up local cache for any tenant the user was removed from
    const nextCloudIds = new Set(
      (loadCachedSessionBundle()?.workspaces ?? []).map((w) => w.id),
    );
    for (const oldId of prevIds) {
      if (!nextCloudIds.has(oldId)) {
        wipeTenantCache(oldId);
      }
    }
  }, [user, initialSession, workspaces, hydrateAuthenticatedUser]);

  const switchTenant = useCallback(
    (tenantId: string) => {
      const target = workspaces.find((w) => w.id === tenantId);
      if (!target) return;
      setActiveTenantId(target.id);
      saveActiveTenantId(target.id);
      if (typeof window !== "undefined" && !window.location.protocol.startsWith("capacitor") && window.location.pathname.startsWith("/t/")) {
        window.history.replaceState({}, "", `/t/${target.slug}`);
      }
    },
    [workspaces],
  );

  const switchTenantBySlug = useCallback(
    (slug: string) => {
      const target = workspaces.find((w) => w.slug.toLowerCase() === slug.toLowerCase());
      if (!target) return false;
      switchTenant(target.id);
      return true;
    },
    [workspaces, switchTenant],
  );

  const createWorkspace = useCallback(
    async (input: {
      name: string;
      slug?: string;
      kind: TenantKind;
      baseCurrency: Currency;
      mode: "cloud" | "local";
      planCode?: PlanCode;
    }) => {
      if (!user) throw new Error("يجب تسجيل الدخول أولًا");
      if (input.mode === "local") {
        const id = `local-${crypto.randomUUID().slice(0, 12)}`;
        const slugBase = input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const slug = slugBase.length >= 3 ? `${slugBase}-${id.slice(-4)}` : `local-${id.slice(-6)}`;
        const localWs: TenantSummary = {
          id,
          slug,
          name: input.name.trim(),
          kind: input.kind,
          mode: "local",
          baseCurrency: input.baseCurrency,
          role: "owner",
          planCode: "monthly",
          subscriptionStatus: "active",
          currentPeriodEnd: new Date(Date.now() + 365 * 86400_000).toISOString(),
          ownerId: user.id,
          createdAt: new Date().toISOString(),
        };
        const existingLocal = loadLocalWorkspaces(user.id);
        const nextLocal = [...existingLocal, localWs];
        saveLocalWorkspaces(user.id, nextLocal);
        setWorkspaces((prev) => [...prev, localWs]);
        setActiveTenantId(localWs.id);
        return localWs;
      }

      const created = await createCloudWorkspace({
        name: input.name,
        slug: input.slug,
        kind: input.kind,
        baseCurrency: input.baseCurrency,
        planCode: input.planCode,
      });
      setWorkspaces((prev) => [created, ...prev]);
      setActiveTenantId(created.id);
      return created;
    },
    [user],
  );

  const promoteLocalWorkspace = useCallback(
    async (localTenantId: string) => {
      if (!user) throw new Error("يجب تسجيل الدخول أولًا");
      const localWs = workspaces.find((w) => w.id === localTenantId && w.mode === "local");
      if (!localWs) throw new Error("المساحة المحلية غير موجودة");
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`mizan.tenant.${localTenantId}.v1`) : null;
      const localData = (raw ? asData(JSON.parse(raw)) : null) ?? emptyWorkspaceData(localWs.baseCurrency);
      const cloudWs = await createCloudWorkspace({
        name: localWs.name,
        kind: localWs.kind,
        baseCurrency: localWs.baseCurrency,
        planCode: "monthly",
      });
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`mizan.tenant.${cloudWs.id}.v1`, JSON.stringify(pickFinanceData(localData)));
        queueOutboxOperations(cloudWs.id, snapshotToOutboxOps(localData, Date.now()), localStorage);
      }
      const remainingLocal = loadLocalWorkspaces(user.id).filter((w) => w.id !== localTenantId);
      saveLocalWorkspaces(user.id, remainingLocal);
      wipeTenantCache(localTenantId);
      setWorkspaces((prev) => [cloudWs, ...prev.filter((w) => w.id !== localTenantId)]);
      setActiveTenantId(cloudWs.id);
      return cloudWs;
    },
    [user, workspaces],
  );

  const updateActiveWorkspace = useCallback(
    async (patch: Partial<{ name: string; slug: string; kind: TenantKind; baseCurrency: Currency }>) => {
      if (!activeTenant || !user) return;
      if (activeTenant.mode === "local") {
        const updated: TenantSummary = {
          ...activeTenant,
          name: patch.name?.trim() || activeTenant.name,
          kind: patch.kind ?? activeTenant.kind,
          baseCurrency: patch.baseCurrency ?? activeTenant.baseCurrency,
        };
        const nextLocal = loadLocalWorkspaces(user.id).map((w) => (w.id === activeTenant.id ? updated : w));
        saveLocalWorkspaces(user.id, nextLocal);
        setWorkspaces((prev) => prev.map((w) => (w.id === activeTenant.id ? updated : w)));
        return;
      }
      await updateCloudWorkspaceSettings(activeTenant.id, patch);
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeTenant.id
            ? {
                ...w,
                name: patch.name?.trim() || w.name,
                slug: patch.slug?.trim().toLowerCase() || w.slug,
                kind: patch.kind ?? w.kind,
                baseCurrency: patch.baseCurrency ?? w.baseCurrency,
              }
            : w,
        ),
      );
    },
    [activeTenant, user],
  );

  const activatePlan = useCallback(
    async (planCode: PlanCode) => {
      if (!activeTenant || activeTenant.mode !== "cloud") return;
      const updated = await activateTenantPlan(activeTenant.id, planCode);
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeTenant.id
            ? {
                ...w,
                planCode: updated.planCode,
                subscriptionStatus: updated.subscriptionStatus,
                currentPeriodEnd: updated.currentPeriodEnd,
              }
            : w,
        ),
      );
    },
    [activeTenant],
  );

  const acceptInviteCode = useCallback(
    async (code: string) => {
      if (!user) {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(PENDING_INVITE_KEY, code.trim().toUpperCase());
        }
        return null;
      }
      const res = await redeemTenantInvite(code);
      await hydrateAuthenticatedUser(user);
      setActiveTenantId(res.tenantId);
      saveActiveTenantId(res.tenantId);
      const found = workspaces.find((w) => w.id === res.tenantId);
      return (
        found ?? {
          id: res.tenantId,
          slug: res.slug,
          name: res.name,
          kind: "business",
          mode: "cloud",
          baseCurrency: "EGP",
          role: res.role,
          planCode: "monthly",
          subscriptionStatus: "trialing",
          currentPeriodEnd: new Date().toISOString(),
          ownerId: "",
          createdAt: new Date().toISOString(),
        }
      );
    },
    [user, workspaces, hydrateAuthenticatedUser],
  );

  const syncNow = useCallback(async () => {
    await syncSpecificTenant(activeTenant);
  }, [activeTenant, syncSpecificTenant]);

  const signOut = useCallback(async () => {
    configureReceiptSyncScope({ tenantId: null, mode: "local", canWrite: true });
    clearFinanceTenantScope();
    wipeAllTenantCachesOnSignOut();
    if (!initialSession) {
      await signOutSupabase();
    }
    setUser(null);
    setIsSuperAdmin(false);
    setWorkspaces([]);
    setActiveTenantId(null);
    setAuthStatus("unauthenticated");
  }, [initialSession]);

  const value = useMemo<TenantContextValue>(
    () => ({
      authStatus,
      user,
      isSuperAdmin,
      workspaces,
      plans,
      activeTenant,
      canWrite,
      isOnline,
      syncStatus,
      pendingOpsCount,
      rejectedSyncItems,
      lastSyncedAt,
      migratedLegacyNotice,
      passwordRecoveryPending,
      clearPasswordRecovery: () => setPasswordRecoveryPending(false),
      dismissMigratedNotice: () => setMigratedLegacyNotice(false),
      dismissRejectedSync: () => setRejectedSyncItems([]),
      switchTenant,
      switchTenantBySlug,
      refreshWorkspaces,
      syncNow,
      createWorkspace,
      promoteLocalWorkspace,
      updateActiveWorkspace,
      activatePlan,
      acceptInviteCode,
      signOut,
    }),
    [
      authStatus,
      user,
      isSuperAdmin,
      workspaces,
      plans,
      activeTenant,
      canWrite,
      isOnline,
      syncStatus,
      pendingOpsCount,
      rejectedSyncItems,
      lastSyncedAt,
      migratedLegacyNotice,
      passwordRecoveryPending,
      switchTenant,
      switchTenantBySlug,
      refreshWorkspaces,
      syncNow,
      createWorkspace,
      promoteLocalWorkspace,
      updateActiveWorkspace,
      activatePlan,
      acceptInviteCode,
      signOut,
    ],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
