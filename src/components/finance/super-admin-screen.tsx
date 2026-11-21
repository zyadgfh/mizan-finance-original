import {
  AlertTriangle,
  Ban,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Eye,
  KeyRound,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { CURRENCIES, type Currency } from "@/lib/finance/types";
import { copyTextSafe } from "@/lib/mobile-safe";
import {
  adminCreateUserAccount,
  adminDeleteUserAccount,
  adminListTenants,
  adminListUsers,
  adminReviewPaymentRequest,
  adminUpdatePlanPrice,
  adminUpdatePlatformBillingInfo,
  adminUpdateTenantSubscription,
  adminUpdateUserAccount,
  enforceExpiredSubscriptionsNow,
  fetchPlatformBillingInfo,
  getPaymentProofSignedUrl,
  listPaymentRequests,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  formatPlanLabel,
  formatRoleLabel,
  formatSubscriptionStatusLabel,
  getRemainingSubscriptionDays,
  type AdminManagedUser,
  type AdminTenantOverview,
  type PaymentRequestItem,
  type PlanCode,
  type SubscriptionStatus,
  type TenantKind,
  type TenantRole,
} from "@/lib/tenant/types";

function generateStrongPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

type TenantFilter = "all" | "pending_approval" | "active" | "expiring_soon" | "expired" | "suspended";

export function SuperAdminScreen() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { isSuperAdmin, plans, refreshWorkspaces } = useTenant();

  const effectivePlans = plans.length > 0 ? plans : DEFAULT_SUBSCRIPTION_PLANS;

  const [tab, setTab] = useState<"payments" | "tenants" | "settings" | "users">("payments");
  const [tenants, setTenants] = useState<AdminTenantOverview[]>([]);
  const [users, setUsers] = useState<AdminManagedUser[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestItem[]>([]);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Tenant filters & custom dates
  const [tenantFilter, setTenantFilter] = useState<TenantFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [customEndDates, setCustomEndDates] = useState<Record<string, string>>({});

  // 4 Package price editors
  const [planPrices, setPlanPrices] = useState<Record<PlanCode, string>>({
    monthly: "29",
    quarterly: "75",
    semiannual: "135",
    yearly: "240",
  });

  // Platform billing receiver settings
  const [instapayHandle, setInstapayHandle] = useState("");
  const [vodafoneCashNumber, setVodafoneCashNumber] = useState("");
  const [bankDetails, setBankDetails] = useState("");
  const [instructionsAr, setInstructionsAr] = useState("");

  // Owner Manual User Creation Form
  const [newEmailOrPhone, setNewEmailOrPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState(() => generateStrongPassword());
  const [wsMode, setWsMode] = useState<"create" | "existing" | "none">("create");
  const [wsName, setWsName] = useState("");
  const [wsKind, setWsKind] = useState<TenantKind>("personal");
  const [wsCurrency, setWsCurrency] = useState<Currency>("EGP");
  const [wsPlan, setWsPlan] = useState<PlanCode>("monthly");
  const [wsStatus, setWsStatus] = useState<"active" | "pending_approval">("active");
  const [existingTenantId, setExistingTenantId] = useState("");
  const [existingRole, setExistingRole] = useState<Exclude<TenantRole, "owner">>("member");
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    password: string;
    displayName: string;
  } | null>(null);
  const [adminDialog, setAdminDialog] = useState<
    | null
    | { kind: "reject-payment"; req: PaymentRequestItem; note: string }
    | { kind: "reset-password"; user: AdminManagedUser; nextPass: string }
    | { kind: "delete-user"; user: AdminManagedUser }
  >(null);

  useEffect(() => {
    const next: Record<PlanCode, string> = {
      monthly: String(effectivePlans.find((p) => p.code === "monthly")?.priceEgp ?? 29),
      quarterly: String(effectivePlans.find((p) => p.code === "quarterly")?.priceEgp ?? 75),
      semiannual: String(effectivePlans.find((p) => p.code === "semiannual")?.priceEgp ?? 135),
      yearly: String(effectivePlans.find((p) => p.code === "yearly")?.priceEgp ?? 240),
    };
    setPlanPrices(next);
  }, [effectivePlans]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantList, reqList, billingInfo] = await Promise.all([
        adminListTenants().catch(() => []),
        listPaymentRequests().catch(() => []),
        fetchPlatformBillingInfo().catch(() => null),
      ]);
      setTenants(tenantList);
      setPaymentRequests(reqList);

      if (tenantList[0] && !existingTenantId) {
        setExistingTenantId(tenantList[0].id);
      }

      if (billingInfo) {
        setInstapayHandle(billingInfo.instapayHandle);
        setVodafoneCashNumber(billingInfo.vodafoneCashNumber);
        setBankDetails(billingInfo.bankDetails);
        setInstructionsAr(billingInfo.instructionsAr);
      }

      // Resolve signed URLs for payment proofs
      const withProofs = reqList.filter((r) => Boolean(r.proofPath)).slice(0, 30);
      if (withProofs.length > 0) {
        const entries = await Promise.all(
          withProofs.map(async (r) => {
            const url = r.proofPath ? await getPaymentProofSignedUrl(r.proofPath).catch(() => null) : null;
            return [r.id, url] as const;
          }),
        );
        const urlMap: Record<string, string> = {};
        for (const [id, url] of entries) {
          if (url) urlMap[id] = url;
        }
        setProofUrls(urlMap);
      }

      const userList = await adminListUsers().catch(() => []);
      setUsers(userList);
    } finally {
      setLoading(false);
    }
  }, [existingTenantId]);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

  const pendingPaymentsCount = paymentRequests.filter((r) => r.status === "pending").length;
  const activeCount = tenants.filter(
    (t) =>
      (t.subscriptionStatus === "active" || t.subscriptionStatus === "trialing") &&
      getRemainingSubscriptionDays(t.currentPeriodEnd) > 0,
  ).length;
  const expiringSoonCount = tenants.filter((t) => {
    const days = getRemainingSubscriptionDays(t.currentPeriodEnd);
    return (t.subscriptionStatus === "active" || t.subscriptionStatus === "trialing") && days > 0 && days <= 7;
  }).length;
  const expiredCount = tenants.filter(
    (t) =>
      t.subscriptionStatus === "expired" ||
      ((t.subscriptionStatus === "active" || t.subscriptionStatus === "trialing") &&
        getRemainingSubscriptionDays(t.currentPeriodEnd) <= 0),
  ).length;

  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants.filter((t) => {
      const days = getRemainingSubscriptionDays(t.currentPeriodEnd);
      const isAutoExpired =
        t.subscriptionStatus === "expired" ||
        ((t.subscriptionStatus === "active" || t.subscriptionStatus === "trialing") && days <= 0);

      if (tenantFilter === "pending_approval" && t.subscriptionStatus !== "pending_approval") return false;
      if (tenantFilter === "active" && (isAutoExpired || !["active", "trialing"].includes(t.subscriptionStatus))) {
        return false;
      }
      if (
        tenantFilter === "expiring_soon" &&
        (isAutoExpired || !["active", "trialing"].includes(t.subscriptionStatus) || days > 7)
      ) {
        return false;
      }
      if (tenantFilter === "expired" && !isAutoExpired) return false;
      if (tenantFilter === "suspended" && t.subscriptionStatus !== "suspended") return false;

      if (q) {
        const hay = `${t.name} ${t.slug} ${t.ownerName} ${t.ownerEmail} ${t.ownerPhone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, tenantFilter, searchQuery]);

  if (!isSuperAdmin) {
    return (
      <div className="bg-[var(--surface)] rounded-2xl p-6 text-center space-y-2 border border-[var(--sep)]">
        <ShieldAlert className="w-8 h-8 text-[var(--red)] mx-auto" />
        <div className="font-bold text-[16px]">{isAr ? "صلاحية Super-Admin مطلوبة" : "Super-Admin Required"}</div>
        <p className="text-[13px] text-[var(--label-3)]">
          {isAr ? "هذا القسم مخصص لمالك المنصة فقط." : "This console is restricted to the platform owner."}
        </p>
      </div>
    );
  }

  const copyValue = async (val: string, label: string) => {
    if (!val) return;
    const copied = await copyTextSafe(val);
    if (copied) {
      toast.success(isAr ? `تم نسخ ${label}` : `${label} copied`);
    } else {
      toast.info(val);
    }
  };

  const handleEnforceExpiredSweep = async () => {
    setBusy(true);
    try {
      const count = await enforceExpiredSubscriptionsNow();
      await load();
      toast.success(
        count > 0
          ? isAr
            ? `تم تعطيل ${count} حساب منتهي الصلاحية تلقائياً`
            : `Auto-deactivated ${count} expired account(s)`
          : isAr
            ? "تم الفحص: جميع الاشتراكات المنتهية معطّلة بالفعل"
            : "Checked: all expired accounts are already deactivated",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReviewPayment = async (
    req: PaymentRequestItem,
    decision: "approved" | "rejected",
    adminNote?: string,
  ) => {
    if (decision === "rejected" && adminNote === undefined) {
      setAdminDialog({ kind: "reject-payment", req, note: "" });
      return;
    }

    setBusy(true);
    try {
      await adminReviewPaymentRequest({
        requestId: req.id,
        decision,
        adminNote: adminNote?.trim() || undefined,
      });
      setAdminDialog(null);
      await load();
      await refreshWorkspaces();
      toast.success(
        decision === "approved"
          ? isAr
            ? `تم تأكيد الدفع وتفعيل حساب المشترك (${formatPlanLabel(req.planCode, "ar")}) بنجاح`
            : "Payment confirmed and subscriber account activated!"
          : isAr
            ? "تم رفض طلب الدفع وإشعار المشترك"
            : "Payment request rejected",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const updateTenant = async (
    tenantId: string,
    patch: { planCode?: PlanCode; status?: SubscriptionStatus; extendDays?: number; exactPeriodEnd?: string | null },
  ) => {
    setBusy(true);
    try {
      await adminUpdateTenantSubscription({ tenantId, ...patch });
      await load();
      await refreshWorkspaces();
      toast.success(isAr ? "تم تحديث اشتراك المشترك بنجاح" : "Subscription updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomDate = async (tenantId: string) => {
    const rawDate = customEndDates[tenantId];
    if (!rawDate) {
      toast.error(isAr ? "اختر التاريخ أولاً" : "Pick a date first");
      return;
    }
    const isoEnd = new Date(`${rawDate}T23:59:59`).toISOString();
    const isFuture = new Date(isoEnd).getTime() > Date.now();
    await updateTenant(tenantId, {
      status: isFuture ? "active" : "expired",
      exactPeriodEnd: isoEnd,
    });
  };

  const handleSaveAllPrices = async () => {
    setBusy(true);
    try {
      const codes: PlanCode[] = ["monthly", "quarterly", "semiannual", "yearly"];
      for (const c of codes) {
        const num = Number(planPrices[c]);
        if (Number.isFinite(num) && num >= 0) {
          await adminUpdatePlanPrice(c, num);
        }
      }
      await refreshWorkspaces();
      toast.success(isAr ? "تم حفظ أسعار جميع الباقات بنجاح" : "All package prices saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBillingInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminUpdatePlatformBillingInfo({
        instapayHandle,
        vodafoneCashNumber,
        bankDetails,
        instructionsAr,
      });
      toast.success(isAr ? "تم حفظ بيانات استلام التحويلات" : "Receiver details saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmailOrPhone.trim() || newPassword.length < 8) {
      toast.error(
        isAr ? "أدخل بريداً أو رقم هاتف صحيح وكلمة مرور من 8 أحرف" : "Enter valid email/phone and 8+ char password",
      );
      return;
    }
    setBusy(true);
    try {
      const savedPass = newPassword;
      const res = await adminCreateUserAccount({
        email: newEmailOrPhone.trim(),
        password: savedPass,
        displayName: newName.trim() || undefined,
        workspaceMode: wsMode,
        workspaceName: wsName.trim() || undefined,
        workspaceKind: wsKind,
        baseCurrency: wsCurrency,
        planCode: wsPlan,
        subscriptionStatus: wsStatus,
        existingTenantId: wsMode === "existing" ? existingTenantId : undefined,
        existingRole: wsMode === "existing" ? existingRole : undefined,
      });
      setCreatedCreds({
        email: res.user.email,
        password: savedPass,
        displayName: res.user.displayName,
      });
      setNewEmailOrPhone("");
      setNewName("");
      setWsName("");
      setNewPassword(generateStrongPassword());
      await load();
      toast.success(isAr ? "تم إنشاء الحساب بنجاح" : "Account created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const copyCredentials = async () => {
    if (!createdCreds) return;
    const siteUrl =
      typeof window !== "undefined" && window.location.origin.startsWith("http")
        ? window.location.origin
        : "https://mizan-finance-rho.vercel.app";
    const text = isAr
      ? `بيانات دخولك إلى منصة ميزان المالية:\nالرابط: ${siteUrl}\nالبريد أو رقم الهاتف: ${createdCreds.email}\nكلمة المرور: ${createdCreds.password}`
      : `Mizan Finance Login:\nURL: ${siteUrl}\nEmail/Phone: ${createdCreds.email}\nPassword: ${createdCreds.password}`;
    await copyValue(text, isAr ? "بيانات الدخول" : "Credentials");
  };

  const handleResetUserPassword = (u: AdminManagedUser) => {
    setAdminDialog({
      kind: "reset-password",
      user: u,
      nextPass: generateStrongPassword(),
    });
  };

  const confirmResetUserPassword = async () => {
    if (!adminDialog || adminDialog.kind !== "reset-password") return;
    const { user: u, nextPass } = adminDialog;
    if (!nextPass || nextPass.trim().length < 8) {
      toast.error(isAr ? "كلمة المرور 8 أحرف على الأقل" : "At least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await adminUpdateUserAccount({ userId: u.id, password: nextPass.trim() });
      setCreatedCreds({ email: u.email, password: nextPass.trim(), displayName: u.displayName });
      setAdminDialog(null);
      toast.success(isAr ? "تم تحديث كلمة المرور" : "Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmUserLogin = async (u: AdminManagedUser) => {
    setBusy(true);
    try {
      await adminUpdateUserAccount({ userId: u.id, emailConfirm: true });
      await load();
      toast.success(
        isAr ? `تم تفعيل تسجيل الدخول للحساب (${u.email})` : `Sign-in activated for ${u.email}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBanUser = async (u: AdminManagedUser) => {
    try {
      await adminUpdateUserAccount({ userId: u.id, banned: !u.banned });
      await load();
      toast.success(
        u.banned
          ? isAr
            ? "تم رفع الحظر عن الحساب"
            : "Account restored"
          : isAr
            ? "تم حظر تسجيل دخول الحساب فوراً"
            : "Account banned",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDeleteUser = (u: AdminManagedUser) => {
    setAdminDialog({ kind: "delete-user", user: u });
  };

  const confirmDeleteUser = async () => {
    if (!adminDialog || adminDialog.kind !== "delete-user") return;
    setBusy(true);
    try {
      await adminDeleteUserAccount(adminDialog.user.id);
      setAdminDialog(null);
      await load();
      toast.success(isAr ? "تم حذف الحساب" : "Account deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-[20px] sm:text-[22px] font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-[var(--tint)]" />
            {isAr ? "إدارة الاشتراكات والمدفوعات (المالك)" : "Subscriptions & Billing Console"}
          </h2>
          <p className="text-[12px] text-[var(--label-3)]">
            {isAr
              ? "مراجعة إيصالات التحويل، تفعيل المشتركين، والتحكم التلقائي واليدوي في مدد الاشتراكات"
              : "Review transfer screenshots, activate subscribers, and control subscription periods"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEnforceExpiredSweep()}
            className="h-9 px-3 rounded-full bg-[var(--fill)] text-[11px] font-semibold flex items-center gap-1.5"
            title={isAr ? "فحص وتعطيل أي اشتراك انتهت مدته الآن" : "Enforce expired subscriptions now"}
          >
            <Clock className="w-3.5 h-3.5 text-[var(--tint)]" />
            {isAr ? "فحص المنتهية" : "Sweep Expired"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="h-9 px-3 rounded-full bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {isAr ? "تحديث" : "Refresh"}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
          <div className="text-[11px] text-[var(--label-3)]">
            {isAr ? "طلبات دفع بانتظارك" : "Pending Approvals"}
          </div>
          <div className={`text-[22px] font-extrabold mt-1 ${pendingPaymentsCount > 0 ? "text-[var(--tint)]" : ""}`}>
            {pendingPaymentsCount}
          </div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
          <div className="text-[11px] text-[var(--label-3)]">
            {isAr ? "الاشتراكات النشطة" : "Active Subscriptions"}
          </div>
          <div className="text-[22px] font-extrabold mt-1 text-[var(--green)]">{activeCount}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
          <div className="text-[11px] text-[var(--label-3)]">
            {isAr ? "تنتهي خلال 7 أيام" : "Expiring in 7d"}
          </div>
          <div className="text-[22px] font-extrabold mt-1">{expiringSoonCount}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
          <div className="text-[11px] text-[var(--label-3)]">
            {isAr ? "منتهية ومعطّلة تلقائياً" : "Auto-Expired"}
          </div>
          <div className={`text-[22px] font-extrabold mt-1 ${expiredCount > 0 ? "text-[var(--red)]" : ""}`}>
            {expiredCount}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-2xl bg-[var(--fill)]">
        {[
          {
            id: "payments" as const,
            icon: CreditCard,
            label: isAr
              ? `طلبات الدفع${pendingPaymentsCount ? ` (${pendingPaymentsCount})` : ""}`
              : `Requests${pendingPaymentsCount ? ` (${pendingPaymentsCount})` : ""}`,
          },
          { id: "tenants" as const, icon: Building2, label: isAr ? "التحكم بالاشتراكات" : "Subscriptions" },
          { id: "settings" as const, icon: Settings2, label: isAr ? "الباقات والدفع" : "Plans & Receiver" },
          { id: "users" as const, icon: Users, label: isAr ? "الحسابات" : "Accounts" },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`py-2 px-2 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 transition ${
                active ? "bg-[var(--surface)] shadow-sm text-[var(--label)]" : "text-[var(--label-3)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* =======================================================================
          TAB 1: PAYMENT & SUBSCRIPTION REQUESTS (WITH SCREENSHOT REVIEW)
      ======================================================================= */}
      {tab === "payments" && (
        <div className="space-y-3">
          {paymentRequests.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-2xl p-6 text-center text-[13px] text-[var(--label-3)] border border-[var(--sep)]">
              {isAr
                ? "لا توجد طلبات اشتراك أو إيصالات دفع مرسلة حتى الآن."
                : "No subscription payment requests submitted yet."}
            </div>
          ) : (
            paymentRequests.map((req) => {
              const proofUrl = proofUrls[req.id] ?? null;
              return (
                <div
                  key={req.id}
                  className={`p-4 rounded-2xl bg-[var(--surface)] border space-y-3 ${
                    req.status === "pending" ? "border-[var(--tint)] shadow-sm" : "border-[var(--sep)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-[15px]">{req.tenantName}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            req.requestType === "new_registration"
                              ? "bg-[var(--tint-soft)] text-[var(--tint)]"
                              : "bg-[var(--fill)] text-[var(--label-2)]"
                          }`}
                        >
                          {req.requestType === "new_registration"
                            ? isAr
                              ? "تسجيل مشترك جديد"
                              : "New Registration"
                            : isAr
                              ? "تجديد اشتراك"
                              : "Renewal"}
                        </span>
                      </div>

                      <div className="text-[12px] text-[var(--label-2)] flex items-center gap-2 flex-wrap">
                        <strong dir="ltr">{req.submitterContact || req.submitterEmail}</strong>
                        <span>·</span>
                        <span>{new Date(req.createdAt).toLocaleString(isAr ? "ar-EG" : "en-US")}</span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        req.status === "approved"
                          ? "bg-[var(--green-soft)] text-[var(--green)]"
                          : req.status === "rejected"
                            ? "bg-[var(--red-soft)] text-[var(--red)]"
                            : "bg-[var(--tint-soft)] text-[var(--tint)]"
                      }`}
                    >
                      {req.status === "pending"
                        ? isAr
                          ? "بانتظار مراجعتك"
                          : "Pending Review"
                        : req.status === "approved"
                          ? isAr
                            ? "مؤكّد ومفعّل"
                            : "Approved"
                          : isAr
                            ? "مرفوض"
                            : "Rejected"}
                    </span>
                  </div>

                  {/* Package + Sender Details Box */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-xl bg-[var(--fill)] text-[12px]">
                    <div>
                      <div className="text-[10px] text-[var(--label-3)]">
                        {isAr ? "الباقة والمبلغ" : "Package & Amount"}
                      </div>
                      <div className="font-extrabold text-[14px] text-[var(--tint)]">
                        {formatPlanLabel(req.planCode, lang)} — {req.amountEgp} {isAr ? "ج.م" : "EGP"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--label-3)]">
                        {isAr ? "وسيلة التحويل" : "Method"}
                      </div>
                      <div className="font-bold">
                        {req.paymentMethod === "instapay"
                          ? "InstaPay (إنستا باي)"
                          : req.paymentMethod === "vodafone_cash"
                            ? isAr
                              ? "فودافون كاش / محفظة"
                              : "Vodafone Cash"
                            : req.paymentMethod}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--label-3)]">
                        {isAr ? "الرقم المحوّل منه / يوزر إنستا باي" : "Sender Phone / IPA"}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <strong className="font-mono text-[13px]" dir="ltr">
                          {req.senderHandle || req.referenceCode}
                        </strong>
                        <button
                          type="button"
                          onClick={() =>
                            void copyValue(req.senderHandle || req.referenceCode, isAr ? "بيانات المحوّل" : "Sender")
                          }
                          className="p-1 rounded bg-[var(--surface)] text-[var(--tint)]"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Transfer Screenshot Preview */}
                  {proofUrl && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[var(--label-2)]">
                          {isAr ? "صورة إيصال التحويل المرفقة:" : "Uploaded Transfer Screenshot:"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(proofUrl)}
                          className="text-[var(--tint)] font-bold flex items-center gap-1 hover:underline"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {isAr ? "تكبير الصورة بملء الشاشة" : "View Full Screen"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(proofUrl)}
                        className="block w-full rounded-xl overflow-hidden border border-[var(--sep)] bg-black/5"
                      >
                        <img
                          src={proofUrl}
                          alt="Transfer receipt"
                          className="w-full max-h-60 object-contain mx-auto"
                        />
                      </button>
                    </div>
                  )}

                  {req.adminNote && (
                    <div className="text-[11px] text-[var(--label-2)]">
                      {isAr ? "ملاحظة المراجعة: " : "Review note: "}
                      <strong>{req.adminNote}</strong>
                    </div>
                  )}

                  {req.status === "pending" && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <PillButton
                        type="button"
                        disabled={busy}
                        onClick={() => void handleReviewPayment(req, "approved")}
                        className="flex-1 h-10 text-[13px] justify-center"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {isAr
                            ? `تأكيد الدفع وتفعيل الحساب (${formatPlanLabel(req.planCode, "ar")})`
                            : "Confirm Payment & Activate Subscriber"}
                        </span>
                      </PillButton>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleReviewPayment(req, "rejected")}
                        className="h-10 px-4 rounded-full bg-[var(--red-soft)] text-[var(--red)] text-[12px] font-bold flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        {isAr ? "رفض الطلب" : "Reject"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* =======================================================================
          TAB 2: ADVANCED SUBSCRIPTION & EXPIRATION CONTROLS
      ======================================================================= */}
      {tab === "tenants" && (
        <div className="space-y-3">
          {/* Search + Status Filters */}
          <div className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)] space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isAr
                    ? "ابحث باسم المشترك، رقم الهاتف، أو البريد الإلكتروني…"
                    : "Search by subscriber name, phone, or email…"
                }
                className="w-full h-10 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[13px] outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "all", label: isAr ? `الكل (${tenants.length})` : `All (${tenants.length})` },
                  { id: "pending_approval", label: isAr ? "بانتظار التفعيل" : "Pending" },
                  { id: "active", label: isAr ? `نشط (${activeCount})` : `Active (${activeCount})` },
                  {
                    id: "expiring_soon",
                    label: isAr ? `ينتهي قريباً (${expiringSoonCount})` : `Expiring (${expiringSoonCount})`,
                  },
                  {
                    id: "expired",
                    label: isAr ? `منتهي ومعطّل (${expiredCount})` : `Expired (${expiredCount})`,
                  },
                  { id: "suspended", label: isAr ? "موقوف يدوياً" : "Suspended" },
                ] as Array<{ id: TenantFilter; label: string }>
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTenantFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition ${
                    tenantFilter === f.id
                      ? "bg-[var(--tint)] text-white"
                      : "bg-[var(--fill)] text-[var(--label-2)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredTenants.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-2xl p-6 text-center text-[13px] text-[var(--label-3)] border border-[var(--sep)]">
              {isAr ? "لا توجد اشتراكات مطابقة للفلتر الحالي." : "No matching subscriptions."}
            </div>
          ) : (
            filteredTenants.map((t) => {
              const daysLeft = getRemainingSubscriptionDays(t.currentPeriodEnd);
              const isExpired =
                t.subscriptionStatus === "expired" ||
                ((t.subscriptionStatus === "active" || t.subscriptionStatus === "trialing") && daysLeft <= 0);
              const isDisabled =
                isExpired || t.subscriptionStatus === "suspended" || t.subscriptionStatus === "pending_approval";
              const displayStatus: SubscriptionStatus = isExpired ? "expired" : t.subscriptionStatus;

              return (
                <div
                  key={t.id}
                  className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-bold text-[15px] flex items-center gap-2 flex-wrap">
                        <span>{t.name}</span>
                        <span className="px-2 py-0.5 rounded-full bg-[var(--fill)] text-[11px] font-semibold text-[var(--label-2)]">
                          {formatPlanLabel(t.planCode, lang)}
                        </span>
                      </div>
                      <div className="text-[12px] text-[var(--label-3)] mt-0.5">
                        <strong>{t.ownerName}</strong> · <span dir="ltr">{t.ownerEmail}</span> · {t.recordCount}{" "}
                        {isAr ? "سجل" : "records"}
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        displayStatus === "active" || displayStatus === "trialing"
                          ? "bg-[var(--green-soft)] text-[var(--green)]"
                          : displayStatus === "pending_approval"
                            ? "bg-[var(--tint-soft)] text-[var(--tint)]"
                            : "bg-[var(--red-soft)] text-[var(--red)]"
                      }`}
                    >
                      {formatSubscriptionStatusLabel(displayStatus, lang)}
                    </span>
                  </div>

                  {/* Expiration Date & Countdown Bar */}
                  <div className="p-2.5 rounded-xl bg-[var(--fill)] flex items-center justify-between gap-2 flex-wrap text-[12px]">
                    <div className="flex items-center gap-1.5 text-[var(--label-2)]">
                      <Calendar className="w-3.5 h-3.5 text-[var(--tint)]" />
                      <span>{isAr ? "تاريخ انتهاء الفترة:" : "Period Ends:"}</span>
                      <strong className="text-[var(--label)]">
                        {new Date(t.currentPeriodEnd).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                      </strong>
                    </div>

                    <span
                      className={`font-bold text-[12px] flex items-center gap-1 ${
                        displayStatus === "pending_approval"
                          ? "text-[var(--tint)]"
                          : daysLeft <= 0
                            ? "text-[var(--red)]"
                            : daysLeft <= 7
                              ? "text-amber-600"
                              : "text-[var(--green)]"
                      }`}
                    >
                      {displayStatus === "pending_approval" ? (
                        isAr ? (
                          "لم يبدأ بعد (بانتظار التفعيل)"
                        ) : (
                          "Awaiting activation"
                        )
                      ) : daysLeft > 0 ? (
                        isAr ? (
                          `متبقي ${daysLeft} يوم`
                        ) : (
                          `${daysLeft} days left`
                        )
                      ) : (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {isAr ? "انتهت المدة وتم التعطيل تلقائياً" : "Expired & Auto-Disabled"}
                        </>
                      )}
                    </span>
                  </div>

                  {/* Quick Package Activation / Extension Buttons */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-[var(--label-3)]">
                      {isAr ? "تفعيل أو تمديد سريع بالباقة:" : "Quick Activate / Extend:"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { code: "monthly" as const, days: 30, label: isAr ? "+ شهر" : "+ 1 Mo" },
                        { code: "quarterly" as const, days: 90, label: isAr ? "+ 3 أشهر" : "+ 3 Mo" },
                        { code: "semiannual" as const, days: 180, label: isAr ? "+ 6 أشهر" : "+ 6 Mo" },
                        { code: "yearly" as const, days: 365, label: isAr ? "+ سنة" : "+ 1 Yr" },
                      ].map((btn) => (
                        <button
                          key={btn.code}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void updateTenant(t.id, {
                              planCode: btn.code,
                              status: "active",
                              extendDays: btn.days,
                            })
                          }
                          className="h-8 px-3 rounded-lg bg-[var(--tint-soft)] text-[var(--tint)] text-[11px] font-bold hover:opacity-90"
                        >
                          {btn.label}
                        </button>
                      ))}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void updateTenant(t.id, {
                            status: isDisabled ? "active" : "suspended",
                            extendDays: isDisabled && daysLeft <= 0 ? 30 : 0,
                          })
                        }
                        className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1 ms-auto ${
                          isDisabled
                            ? "bg-[var(--green-soft)] text-[var(--green)]"
                            : "bg-[var(--red-soft)] text-[var(--red)]"
                        }`}
                      >
                        {isDisabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        {isDisabled
                          ? isAr
                            ? "تفعيل الحساب"
                            : "Activate"
                          : isAr
                            ? "تعطيل الحساب فوراً"
                            : "Deactivate"}
                      </button>
                    </div>
                  </div>

                  {/* Custom Exact End Date Picker */}
                  <div className="flex items-center gap-2 pt-1 border-t border-[var(--sep)]">
                    <span className="text-[11px] text-[var(--label-3)] shrink-0">
                      {isAr ? "تحديد انتهاء مخصص:" : "Set exact expiry:"}
                    </span>
                    <input
                      type="date"
                      dir="ltr"
                      value={customEndDates[t.id] ?? t.currentPeriodEnd.slice(0, 10)}
                      onChange={(e) =>
                        setCustomEndDates((prev) => ({
                          ...prev,
                          [t.id]: e.target.value,
                        }))
                      }
                      className="h-8 px-2.5 rounded-lg bg-[var(--fill)] text-[12px] flex-1 max-w-[170px]"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveCustomDate(t.id)}
                      className="h-8 px-3 rounded-lg bg-[var(--fill)] hover:bg-[var(--tint-soft)] text-[11px] font-bold text-[var(--tint)]"
                    >
                      {isAr ? "ضبط التاريخ" : "Apply Date"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* =======================================================================
          TAB 3: 4 PACKAGE PRICES & PAYMENT RECEIVER SETTINGS
      ======================================================================= */}
      {tab === "settings" && (
        <div className="space-y-4">
          {/* 4 Package Prices */}
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3.5">
            <div>
              <div className="font-bold text-[15px]">
                {isAr ? "أسعار الباقات الأربع (جنيه مصري)" : "4 Subscription Package Prices (EGP)"}
              </div>
              <p className="text-[12px] text-[var(--label-3)]">
                {isAr
                  ? "تظهر هذه الأسعار فوراً في شاشة تسجيل حساب جديد وشاشة تجديد الاشتراك."
                  : "Updated prices reflect immediately on the registration and renewal screens."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["monthly", "quarterly", "semiannual", "yearly"] as PlanCode[]).map((code) => (
                <div key={code} className="p-3 rounded-xl bg-[var(--fill)] space-y-1">
                  <label className="text-[12px] font-bold text-[var(--label)] block">
                    {formatPlanLabel(code, lang)}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="1"
                      dir="ltr"
                      value={planPrices[code]}
                      onChange={(e) => setPlanPrices((prev) => ({ ...prev, [code]: e.target.value }))}
                      className="flex-1 h-9 px-3 rounded-lg bg-[var(--surface)] text-[14px] font-bold"
                    />
                    <span className="text-[12px] text-[var(--label-3)] font-semibold">
                      {isAr ? "ج.م" : "EGP"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <PillButton
              type="button"
              disabled={busy}
              onClick={() => void handleSaveAllPrices()}
              className="h-10 px-5 text-[13px]"
            >
              <Check className="w-4 h-4" />
              <span>{isAr ? "حفظ أسعار الباقات" : "Save Package Prices"}</span>
            </PillButton>
          </div>

          {/* Receiver Accounts (InstaPay & Vodafone Cash) */}
          <form
            onSubmit={handleSaveBillingInfo}
            className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
          >
            <div className="font-bold text-[15px]">
              {isAr ? "بيانات استلام التحويلات (إنستا باي وفودافون كاش)" : "Payment Receiver Accounts"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  InstaPay Username / IPA
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={instapayHandle}
                  onChange={(e) => setInstapayHandle(e.target.value)}
                  placeholder="username@instapay"
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px] font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  {isAr ? "رقم فودافون كاش / المحفظة" : "Vodafone Cash Number"}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={vodafoneCashNumber}
                  onChange={(e) => setVodafoneCashNumber(e.target.value)}
                  placeholder="010xxxxxxxx"
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px] font-mono"
                />
              </div>
            </div>
            <input
              type="text"
              value={bankDetails}
              onChange={(e) => setBankDetails(e.target.value)}
              placeholder={isAr ? "بيانات إضافية (اختياري)" : "Additional bank details (optional)"}
              className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
            />
            <textarea
              rows={2}
              value={instructionsAr}
              onChange={(e) => setInstructionsAr(e.target.value)}
              placeholder={isAr ? "تعليمات التحويل للمشتركين..." : "Transfer instructions..."}
              className="w-full p-3 rounded-xl bg-[var(--fill)] text-[12px]"
            />
            <PillButton type="submit" disabled={busy} className="h-10 px-5 text-[13px]">
              {isAr ? "حفظ بيانات التحويل" : "Save Receiver Info"}
            </PillButton>
          </form>
        </div>
      )}

      {/* =======================================================================
          TAB 4: ACCOUNTS DIRECTORY & DIRECT CREATION BY OWNER
      ======================================================================= */}
      {tab === "users" && (
        <div className="space-y-4">
          {createdCreds && (
            <div className="bg-[var(--tint-soft)] border border-[var(--tint)] rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-[14px] text-[var(--tint)] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  {isAr ? "بيانات الدخول جاهزة للإرسال" : "Credentials Ready"}
                </div>
                <button
                  type="button"
                  onClick={() => setCreatedCreds(null)}
                  className="text-[11px] text-[var(--label-3)]"
                >
                  {isAr ? "إغلاق" : "Dismiss"}
                </button>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface)] text-[12px] font-mono space-y-1" dir="ltr">
                <div>Login: {createdCreds.email}</div>
                <div>Password: {createdCreds.password}</div>
              </div>
              <PillButton type="button" onClick={() => void copyCredentials()} className="w-full h-9 text-[12px]">
                <Copy className="w-3.5 h-3.5" />
                <span>{isAr ? "نسخ رسالة الدخول كاملة" : "Copy Login Message"}</span>
              </PillButton>
            </div>
          )}

          <form
            onSubmit={handleCreateUser}
            className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
          >
            <div className="font-bold text-[15px] flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[var(--tint)]" />
              {isAr ? "إنشاء حساب مشترك يدوياً" : "Create Subscriber Account Manually"}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  {isAr ? "البريد الإلكتروني أو رقم الهاتف" : "Email or Phone Number"}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={newEmailOrPhone}
                  onChange={(e) => setNewEmailOrPhone(e.target.value)}
                  placeholder="010xxxxxxxx / client@mail.com"
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  {isAr ? "اسم المشترك" : "Subscriber Name"}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={isAr ? "أحمد محمد" : "Subscriber Name"}
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[var(--label-2)]">
                {isAr ? "كلمة المرور" : "Password"}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  dir="ltr"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px] font-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => setNewPassword(generateStrongPassword())}
                  className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--tint)]" />
                  {isAr ? "توليد" : "Generate"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "create" as const, label: isAr ? "مساحة جديدة" : "New Space" },
                { id: "existing" as const, label: isAr ? "ضم لمساحة" : "Existing" },
                { id: "none" as const, label: isAr ? "حساب فقط" : "Account Only" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWsMode(opt.id)}
                  className={`h-9 px-2 rounded-xl text-[12px] font-semibold border ${
                    wsMode === opt.id
                      ? "border-[var(--tint)] bg-[var(--tint-soft)] text-[var(--tint)]"
                      : "border-[var(--sep)] bg-[var(--fill)] text-[var(--label-2)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {wsMode === "create" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                <input
                  type="text"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder={isAr ? "اسم المساحة (اختياري)" : "Workspace Name"}
                  className="col-span-2 sm:col-span-1 h-9 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
                />
                <select
                  value={wsKind}
                  onChange={(e) => setWsKind(e.target.value as TenantKind)}
                  className="h-9 px-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  <option value="personal">{isAr ? "شخصي" : "Personal"}</option>
                  <option value="family">{isAr ? "عائلي" : "Family"}</option>
                  <option value="business">{isAr ? "نشاط تجاري" : "Business"}</option>
                </select>
                <select
                  value={wsCurrency}
                  onChange={(e) => setWsCurrency(e.target.value as Currency)}
                  className="h-9 px-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={wsPlan}
                  onChange={(e) => setWsPlan(e.target.value as PlanCode)}
                  className="h-9 px-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  <option value="monthly">{formatPlanLabel("monthly", lang)}</option>
                  <option value="quarterly">{formatPlanLabel("quarterly", lang)}</option>
                  <option value="semiannual">{formatPlanLabel("semiannual", lang)}</option>
                  <option value="yearly">{formatPlanLabel("yearly", lang)}</option>
                </select>
                <select
                  value={wsStatus}
                  onChange={(e) => setWsStatus(e.target.value as "active" | "pending_approval")}
                  className="h-9 px-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  <option value="active">{isAr ? "مفعّل فوراً" : "Active Immediately"}</option>
                  <option value="pending_approval">{isAr ? "بانتظار الدفع" : "Pending Payment"}</option>
                </select>
              </div>
            )}

            {wsMode === "existing" && tenants.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <select
                  value={existingTenantId}
                  onChange={(e) => setExistingTenantId(e.target.value)}
                  className="h-9 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (/{t.slug})
                    </option>
                  ))}
                </select>
                <select
                  value={existingRole}
                  onChange={(e) => setExistingRole(e.target.value as Exclude<TenantRole, "owner">)}
                  className="h-9 px-3 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  <option value="member">{formatRoleLabel("member", lang)}</option>
                  <option value="viewer">{formatRoleLabel("viewer", lang)}</option>
                  <option value="admin">{formatRoleLabel("admin", lang)}</option>
                </select>
              </div>
            )}

            <PillButton type="submit" disabled={busy} className="w-full h-10 text-[13px] justify-center">
              <UserPlus className="w-4 h-4" />
              <span>
                {busy ? (isAr ? "جارٍ الإنشاء..." : "Creating...") : isAr ? "إنشاء الحساب الآن" : "Create Account"}
              </span>
            </PillButton>
          </form>

          {/* Users Directory */}
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3">
            <div className="font-bold text-[14px]">
              {isAr ? `جميع حسابات المنصة (${users.length})` : `Platform Accounts (${users.length})`}
            </div>
            {users.map((u) => (
              <div
                key={u.id}
                className="py-3 border-t border-[var(--sep)] first:border-t-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-[14px] flex items-center gap-1.5 flex-wrap">
                    <span>{u.displayName}</span>
                    {u.isSuperAdmin && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--tint-soft)] text-[var(--tint)] text-[10px] font-bold">
                        Super-Admin
                      </span>
                    )}
                    {u.banned && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--red-soft)] text-[var(--red)] text-[10px] font-bold">
                        {isAr ? "محظور الدخول" : "Banned"}
                      </span>
                    )}
                    {u.emailVerified === false && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--orange-soft)] text-[var(--orange)] text-[10px] font-bold">
                        {isAr ? "بانتظار التفعيل" : "Unconfirmed"}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[var(--label-3)] truncate font-mono" dir="ltr">
                    {u.email}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {u.emailVerified === false && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleConfirmUserLogin(u)}
                      className="h-8 px-2.5 rounded-lg bg-[var(--green-soft)] text-[var(--green)] text-[11px] font-semibold flex items-center gap-1 disabled:opacity-60"
                    >
                      <Check className="w-3 h-3" />
                      {isAr ? "تفعيل الدخول" : "Activate Login"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleResetUserPassword(u)}
                    className="h-8 px-2.5 rounded-lg bg-[var(--fill)] text-[11px] font-semibold flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3 text-[var(--tint)]" />
                    {isAr ? "كلمة المرور" : "Password"}
                  </button>
                  {!u.isSuperAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleToggleBanUser(u)}
                        className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${
                          u.banned
                            ? "bg-[var(--green-soft)] text-[var(--green)]"
                            : "bg-[var(--red-soft)] text-[var(--red)]"
                        }`}
                      >
                        {u.banned ? <CheckCircle2 className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                        {u.banned ? (isAr ? "رفع الحظر" : "Unban") : isAr ? "حظر الدخول" : "Ban"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        className="h-8 px-2 rounded-lg text-[var(--red)] hover:bg-[var(--red-soft)]"
                        aria-label={isAr ? "حذف الحساب" : "Delete user"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile-Safe Touch Action Modal (replaces native browser prompt/confirm) */}
      {adminDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4 pb-safe"
          onClick={() => !busy && setAdminDialog(null)}
        >
          <div
            className="w-full max-w-md bg-[var(--surface)] rounded-3xl border border-[var(--sep)] p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {adminDialog.kind === "reject-payment" && (
              <>
                <h3 className="text-[16px] font-bold">
                  {isAr ? "رفض طلب التفعيل" : "Reject Payment Request"}
                </h3>
                <p className="text-[12px] text-[var(--label-2)]">
                  {isAr
                    ? "اكتب سبب الرفض ليظهر للمشترك (اختياري) ليتمكن من رفع إيصال صحيح:"
                    : "Optional reason visible to the subscriber:"}
                </p>
                <input
                  type="text"
                  value={adminDialog.note}
                  onChange={(e) => setAdminDialog({ ...adminDialog, note: e.target.value })}
                  placeholder={isAr ? "مثال: صورة الإيصال غير واضحة" : "e.g. Unclear transfer screenshot"}
                  className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px]"
                />
                <div className="flex items-center gap-2 justify-end">
                  <PillButton tone="gray" disabled={busy} onClick={() => setAdminDialog(null)}>
                    {isAr ? "إلغاء" : "Cancel"}
                  </PillButton>
                  <PillButton
                    tone="danger"
                    disabled={busy}
                    onClick={() => void handleReviewPayment(adminDialog.req, "rejected", adminDialog.note)}
                  >
                    {isAr ? "تأكيد الرفض" : "Reject"}
                  </PillButton>
                </div>
              </>
            )}

            {adminDialog.kind === "reset-password" && (
              <>
                <h3 className="text-[16px] font-bold">
                  {isAr ? "تعيين كلمة مرور جديدة" : "Set New Password"}
                </h3>
                <p className="text-[12px] text-[var(--label-2)]" dir="ltr">
                  {adminDialog.user.email}
                </p>
                <input
                  type="text"
                  dir="ltr"
                  value={adminDialog.nextPass}
                  onChange={(e) => setAdminDialog({ ...adminDialog, nextPass: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] font-mono"
                />
                <div className="flex items-center gap-2 justify-end">
                  <PillButton tone="gray" disabled={busy} onClick={() => setAdminDialog(null)}>
                    {isAr ? "إلغاء" : "Cancel"}
                  </PillButton>
                  <PillButton disabled={busy} onClick={() => void confirmResetUserPassword()}>
                    {isAr ? "حفظ كلمة المرور" : "Save Password"}
                  </PillButton>
                </div>
              </>
            )}

            {adminDialog.kind === "delete-user" && (
              <>
                <h3 className="text-[16px] font-bold text-[var(--red)]">
                  {isAr ? "تأكيد حذف الحساب نهائياً" : "Confirm Permanent Deletion"}
                </h3>
                <p className="text-[13px] text-[var(--label-2)]">
                  {isAr
                    ? `هل أنت متأكد من حذف الحساب (${adminDialog.user.email}) نهائياً؟`
                    : `Permanently delete account (${adminDialog.user.email})?`}
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <PillButton tone="gray" disabled={busy} onClick={() => setAdminDialog(null)}>
                    {isAr ? "إلغاء" : "Cancel"}
                  </PillButton>
                  <PillButton tone="danger" disabled={busy} onClick={() => void confirmDeleteUser()}>
                    {isAr ? "حذف نهائياً" : "Delete"}
                  </PillButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full-Screen Transfer Receipt Lightbox Modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-[var(--surface)] rounded-2xl p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1">
              <span className="font-bold text-[14px]">
                {isAr ? "معاينة إيصال التحويل" : "Transfer Screenshot Preview"}
              </span>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="p-1.5 rounded-full bg-[var(--fill)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={lightboxUrl}
              alt="Full transfer receipt"
              className="w-full max-h-[78dvh] object-contain rounded-xl bg-black/5"
            />
          </div>
        </div>
      )}
    </div>
  );
}
