import {
  Ban,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Crown,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { CURRENCIES, type Currency } from "@/lib/finance/types";
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
  fetchPlatformBillingInfo,
  listPaymentRequests,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import {
  formatRoleLabel,
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

export function SuperAdminScreen() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { isSuperAdmin, plans, refreshWorkspaces } = useTenant();

  const [tab, setTab] = useState<"users" | "payments" | "tenants">("users");
  const [tenants, setTenants] = useState<AdminTenantOverview[]>([]);
  const [users, setUsers] = useState<AdminManagedUser[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Plan pricing state
  const [monthlyPrice, setMonthlyPrice] = useState(
    String(plans.find((p) => p.code === "monthly")?.priceEgp ?? 19),
  );
  const [yearlyPrice, setYearlyPrice] = useState(
    String(plans.find((p) => p.code === "yearly")?.priceEgp ?? 149),
  );

  // Platform billing receiver settings
  const [instapayHandle, setInstapayHandle] = useState("");
  const [vodafoneCashNumber, setVodafoneCashNumber] = useState("");
  const [bankDetails, setBankDetails] = useState("");
  const [instructionsAr, setInstructionsAr] = useState("");

  // Owner User Creation Form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState(() => generateStrongPassword());
  const [wsMode, setWsMode] = useState<"create" | "existing" | "none">("create");
  const [wsName, setWsName] = useState("");
  const [wsKind, setWsKind] = useState<TenantKind>("personal");
  const [wsCurrency, setWsCurrency] = useState<Currency>("EGP");
  const [wsPlan, setWsPlan] = useState<PlanCode>("monthly");
  const [wsStatus, setWsStatus] = useState<"active" | "trialing">("active");
  const [existingTenantId, setExistingTenantId] = useState("");
  const [existingRole, setExistingRole] = useState<Exclude<TenantRole, "owner">>("member");
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    password: string;
    displayName: string;
  } | null>(null);

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
      const userList = await adminListUsers().catch(() => []);
      setUsers(userList);
    } finally {
      setLoading(false);
    }
  }, [existingTenantId]);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || newPassword.length < 6) {
      toast.error(
        isAr ? "أدخل بريداً صالحاً وكلمة مرور من 6 أحرف على الأقل" : "Enter valid email and 6+ char password",
      );
      return;
    }
    setBusy(true);
    try {
      const savedPass = newPassword;
      const res = await adminCreateUserAccount({
        email: newEmail.trim(),
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
      setNewEmail("");
      setNewName("");
      setWsName("");
      setNewPassword(generateStrongPassword());
      await load();
      toast.success(isAr ? "تم إنشاء الحساب بنجاح" : "User account created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر إنشاء الحساب" : "Failed to create user");
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
      ? `بيانات دخولك إلى منصة ميزان المالية:\nالرابط: ${siteUrl}\nالبريد الإلكتروني: ${createdCreds.email}\nكلمة المرور: ${createdCreds.password}`
      : `Your Mizan Finance Login Credentials:\nURL: ${siteUrl}\nEmail: ${createdCreds.email}\nPassword: ${createdCreds.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(isAr ? "تم نسخ بيانات الدخول للإرسال" : "Login credentials copied");
    } catch {
      toast.info(text);
    }
  };

  const handleResetUserPassword = async (u: AdminManagedUser) => {
    const generated = generateStrongPassword();
    const nextPass =
      typeof window !== "undefined"
        ? window.prompt(
            isAr
              ? `أدخل كلمة المرور الجديدة للمستخدم ${u.email}:`
              : `Enter new password for ${u.email}:`,
            generated,
          )
        : generated;
    if (!nextPass || nextPass.trim().length < 6) return;
    try {
      await adminUpdateUserAccount({ userId: u.id, password: nextPass.trim() });
      setCreatedCreds({ email: u.email, password: nextPass.trim(), displayName: u.displayName });
      toast.success(isAr ? "تم تحديث كلمة المرور بنجاح" : "Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleToggleBanUser = async (u: AdminManagedUser) => {
    try {
      await adminUpdateUserAccount({ userId: u.id, banned: !u.banned });
      await load();
      toast.success(
        u.banned
          ? isAr
            ? "تمت إعادة تفعيل الحساب"
            : "Account restored"
          : isAr
            ? "تم إيقاف دخول الحساب"
            : "Account suspended",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDeleteUser = async (u: AdminManagedUser) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        isAr ? `هل أنت متأكد من حذف الحساب ${u.email} نهائياً؟` : `Permanently delete ${u.email}?`,
      )
    ) {
      return;
    }
    try {
      await adminDeleteUserAccount(u.id);
      await load();
      toast.success(isAr ? "تم حذف الحساب" : "Account deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
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
      toast.success(isAr ? "تم حفظ بيانات استلام الدفع" : "Payment receiver info saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReviewPayment = async (reqId: string, decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await adminReviewPaymentRequest({ requestId: reqId, decision });
      await load();
      await refreshWorkspaces();
      toast.success(
        decision === "approved"
          ? isAr
            ? "تم اعتماد الدفع وتفعيل باقة المساحة"
            : "Payment approved and plan activated"
          : isAr
            ? "تم رفض طلب الدفع"
            : "Payment request rejected",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const updatePrice = async (code: PlanCode, rawVal: string) => {
    const val = Number(rawVal);
    if (!Number.isFinite(val) || val < 0) return;
    try {
      await adminUpdatePlanPrice(code, val);
      await refreshWorkspaces();
      toast.success(isAr ? "تم تحديث السعر الرمزي للخطة" : "Plan pricing updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const updateTenant = async (
    tenantId: string,
    patch: { planCode?: PlanCode; status?: SubscriptionStatus; extendDays?: number },
  ) => {
    try {
      await adminUpdateTenantSubscription({ tenantId, ...patch });
      await load();
      toast.success(isAr ? "تم تحديث اشتراك المستأجر" : "Tenant updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const totalRecords = tenants.reduce((s, t) => s + t.recordCount, 0);
  const activeCount = tenants.filter((t) => t.subscriptionStatus !== "suspended").length;
  const pendingPaymentsCount = paymentRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-[var(--tint)]" />
            {isAr ? "لوحة تحكم المنصة (Super-Admin)" : "Platform Super-Admin"}
          </h2>
          <p className="text-[12px] text-[var(--label-3)]">
            {isAr
              ? "إنشاء حسابات المستخدمين حصرياً، مراجعة المدفوعات، وإدارة المساحات"
              : "Owner-only user provisioning, payment approvals, and tenant controls"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 px-3 rounded-full bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {isAr ? "تحديث" : "Refresh"}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: isAr ? "المستخدمون" : "Users", val: users.length },
          { label: isAr ? "المساحات النشطة" : "Active Spaces", val: `${activeCount}/${tenants.length}` },
          { label: isAr ? "دفعات بانتظار المراجعة" : "Pending Payments", val: pendingPaymentsCount },
          { label: isAr ? "إجمالي السجلات" : "Records", val: totalRecords },
        ].map((k) => (
          <div key={k.label} className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
            <div className="text-[11px] text-[var(--label-3)]">{k.label}</div>
            <div className="text-[22px] font-bold mt-1">{k.val}</div>
          </div>
        ))}
      </div>

      {/* Section Tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[var(--fill)]">
        {[
          { id: "users" as const, icon: Users, label: isAr ? "الحسابات" : "Users" },
          {
            id: "payments" as const,
            icon: CreditCard,
            label: isAr
              ? `المدفوعات${pendingPaymentsCount ? ` (${pendingPaymentsCount})` : ""}`
              : `Billing${pendingPaymentsCount ? ` (${pendingPaymentsCount})` : ""}`,
          },
          { id: "tenants" as const, icon: Building2, label: isAr ? "المساحات" : "Tenants" },
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
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OWNER-ONLY USER CREATION & MANAGEMENT */}
      {tab === "users" && (
        <div className="space-y-4">
          {createdCreds && (
            <div className="bg-[var(--tint-soft)] border border-[var(--tint)] rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-[14px] text-[var(--tint)] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  {isAr ? "بيانات الدخول جاهزة للإرسال للعميل" : "Credentials Ready to Share"}
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
                <div>Email: {createdCreds.email}</div>
                <div>Password: {createdCreds.password}</div>
              </div>
              <PillButton type="button" onClick={() => void copyCredentials()} className="w-full h-9 text-[12px]">
                <Copy className="w-3.5 h-3.5" />
                <span>{isAr ? "نسخ رسالة الدخول كاملة" : "Copy Full Login Message"}</span>
              </PillButton>
            </div>
          )}

          <form
            onSubmit={handleCreateUser}
            className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
          >
            <div className="font-bold text-[15px] flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[var(--tint)]" />
              {isAr ? "إنشاء حساب مستخدم جديد (مالك المنصة فقط)" : "Create New User Account (Owner Only)"}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  {isAr ? "البريد الإلكتروني" : "Email"}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--label-2)]">
                  {isAr ? "اسم المستخدم / العميل" : "Display Name"}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={isAr ? "أحمد محمد" : "Client Name"}
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[var(--label-2)]">
                {isAr ? "كلمة المرور المبدئية" : "Initial Password"}
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

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[var(--label-2)] block">
                {isAr ? "إعداد المساحة للمستخدم" : "Workspace Assignment"}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "create" as const, label: isAr ? "مساحة جديدة له" : "New Workspace" },
                  { id: "existing" as const, label: isAr ? "ضم لمساحة قائمة" : "Existing Space" },
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
                  <option value="monthly">{isAr ? "شهري" : "Monthly"}</option>
                  <option value="yearly">{isAr ? "سنوي" : "Yearly"}</option>
                </select>
                <select
                  value={wsStatus}
                  onChange={(e) => setWsStatus(e.target.value as "active" | "trialing")}
                  className="h-9 px-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                >
                  <option value="active">{isAr ? "نشط ومفعّل" : "Active"}</option>
                  <option value="trialing">{isAr ? "تجريبي 14 يوم" : "14-Day Trial"}</option>
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
              <span>{busy ? (isAr ? "جارٍ الإنشاء..." : "Creating...") : isAr ? "إنشاء الحساب الآن" : "Create Account"}</span>
            </PillButton>
          </form>

          {/* Users Directory */}
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3">
            <div className="font-bold text-[14px]">
              {isAr ? `جميع حسابات المنصة (${users.length})` : `Platform Accounts (${users.length})`}
            </div>
            {users.length === 0 ? (
              <p className="text-[12px] text-[var(--label-3)]">
                {isAr ? "لا توجد حسابات مسجلة بعد." : "No accounts loaded yet."}
              </p>
            ) : (
              users.map((u) => (
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
                          {isAr ? "موقوف" : "Suspended"}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[var(--label-3)] truncate" dir="ltr">
                      {u.email}
                    </div>
                    {u.workspaces.length > 0 && (
                      <div className="text-[11px] text-[var(--label-2)] mt-0.5">
                        {u.workspaces.map((w) => `${w.name} (${w.role})`).join(" · ")}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleResetUserPassword(u)}
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
                          {u.banned ? (isAr ? "تفعيل" : "Unban") : isAr ? "إيقاف" : "Ban"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(u)}
                          className="h-8 px-2 rounded-lg text-[var(--red)] hover:bg-[var(--red-soft)]"
                          aria-label={isAr ? "حذف الحساب" : "Delete user"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MANUAL PAYMENT CONFIRMATIONS & PLAN PRICING */}
      {tab === "payments" && (
        <div className="space-y-4">
          {/* Pending & Recent Payment Confirmation Requests */}
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3">
            <div className="font-bold text-[15px]">
              {isAr ? "طلبات تأكيد الدفع (إنستاباي / فودافون كاش)" : "Payment Confirmation Requests"}
            </div>
            {paymentRequests.length === 0 ? (
              <p className="text-[12px] text-[var(--label-3)]">
                {isAr ? "لا توجد طلبات دفع مرسلة حتى الآن." : "No payment requests submitted yet."}
              </p>
            ) : (
              paymentRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-xl bg-[var(--fill)] space-y-2 border border-[var(--sep)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-[14px]">
                        {req.tenantName} · {req.amountEgp} {isAr ? "ج.م" : "EGP"} (
                        {req.planCode === "yearly" ? (isAr ? "سنوي" : "Yearly") : isAr ? "شهري" : "Monthly"})
                      </div>
                      <div className="text-[12px] text-[var(--label-3)]">
                        {req.submitterEmail} · {req.paymentMethod} ·{" "}
                        {new Date(req.createdAt).toLocaleString(isAr ? "ar-EG" : "en-US")}
                      </div>
                      <div className="text-[12px] font-mono mt-1">
                        {isAr ? "المرجع:" : "Ref:"} <strong>{req.referenceCode}</strong>
                        {req.senderHandle ? ` · ${req.senderHandle}` : ""}
                      </div>
                      {req.notes && <div className="text-[11px] text-[var(--label-2)] mt-0.5">{req.notes}</div>}
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        req.status === "approved"
                          ? "bg-[var(--green-soft)] text-[var(--green)]"
                          : req.status === "rejected"
                            ? "bg-[var(--red-soft)] text-[var(--red)]"
                            : "bg-[var(--tint-soft)] text-[var(--tint)]"
                      }`}
                    >
                      {req.status === "pending"
                        ? isAr
                          ? "قيد المراجعة"
                          : "Pending"
                        : req.status === "approved"
                          ? isAr
                            ? "مقبول"
                            : "Approved"
                          : isAr
                            ? "مرفوض"
                            : "Rejected"}
                    </span>
                  </div>

                  {req.status === "pending" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleReviewPayment(req.id, "approved")}
                        className="h-8 px-3 rounded-lg bg-[var(--green-soft)] text-[var(--green)] text-[12px] font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {isAr ? "موافقة وتفعيل الباقة" : "Approve & Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleReviewPayment(req.id, "rejected")}
                        className="h-8 px-3 rounded-lg bg-[var(--red-soft)] text-[var(--red)] text-[12px] font-semibold flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {isAr ? "رفض" : "Reject"}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Receiver Details (InstaPay / Vodafone Cash) */}
          <form
            onSubmit={handleSaveBillingInfo}
            className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
          >
            <div className="font-bold text-[14px]">
              {isAr ? "بيانات استلام الدفع المعروضة للمشتركين" : "Payment Receiver Details"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                dir="ltr"
                value={instapayHandle}
                onChange={(e) => setInstapayHandle(e.target.value)}
                placeholder="InstaPay (e.g. username@instapay)"
                className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
              />
              <input
                type="text"
                dir="ltr"
                value={vodafoneCashNumber}
                onChange={(e) => setVodafoneCashNumber(e.target.value)}
                placeholder="Vodafone Cash (010xxxxxxxx)"
                className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
              />
            </div>
            <input
              type="text"
              value={bankDetails}
              onChange={(e) => setBankDetails(e.target.value)}
              placeholder={isAr ? "حساب بنكي إضافي (اختياري)" : "Bank account details (optional)"}
              className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
            />
            <textarea
              rows={2}
              value={instructionsAr}
              onChange={(e) => setInstructionsAr(e.target.value)}
              placeholder={isAr ? "تعليمات الدفع للمستخدمين..." : "Payment instructions..."}
              className="w-full p-3 rounded-xl bg-[var(--fill)] text-[12px]"
            />
            <PillButton type="submit" disabled={busy} className="h-9 px-4 text-[12px]">
              {isAr ? "حفظ بيانات الدفع" : "Save Payment Info"}
            </PillButton>
          </form>

          {/* Plan Pricing Editor */}
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3">
            <div className="font-bold text-[14px]">
              {isAr ? "تسعير الخطط (شهري / سنوي رمزي بدون قيود مميزات)" : "Symbolic Plan Pricing"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] w-20">{isAr ? "الشهري" : "Monthly"}</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={monthlyPrice}
                  onChange={(e) => setMonthlyPrice(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-xl bg-[var(--fill)] text-[14px]"
                />
                <button
                  type="button"
                  onClick={() => void updatePrice("monthly", monthlyPrice)}
                  className="h-9 px-3 rounded-xl bg-[var(--tint)] text-white text-[12px] font-semibold"
                >
                  {isAr ? "حفظ" : "Save"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] w-20">{isAr ? "السنوي" : "Yearly"}</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={yearlyPrice}
                  onChange={(e) => setYearlyPrice(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-xl bg-[var(--fill)] text-[14px]"
                />
                <button
                  type="button"
                  onClick={() => void updatePrice("yearly", yearlyPrice)}
                  className="h-9 px-3 rounded-xl bg-[var(--tint)] text-white text-[12px] font-semibold"
                >
                  {isAr ? "حفظ" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TENANTS DIRECTORY */}
      {tab === "tenants" && (
        <div className="space-y-2.5">
          {tenants.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-2xl p-6 text-center text-[13px] text-[var(--label-3)] border border-[var(--sep)]">
              {isAr ? "لا توجد مساحات مسجلة حالياً." : "No workspaces yet."}
            </div>
          ) : (
            tenants.map((t) => {
              const suspended = t.subscriptionStatus === "suspended";
              return (
                <div key={t.id} className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-[15px]">{t.name}</div>
                      <div className="text-[12px] text-[var(--label-3)]">
                        <span dir="ltr">/{t.slug}</span> · {t.ownerEmail} · {t.memberCount}{" "}
                        {isAr ? "أعضاء" : "members"} · {t.recordCount} {isAr ? "سجل" : "records"}
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        suspended
                          ? "bg-[var(--red-soft)] text-[var(--red)]"
                          : "bg-[var(--green-soft)] text-[var(--green)]"
                      }`}
                    >
                      {t.subscriptionStatus}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        void updateTenant(t.id, { planCode: t.planCode === "monthly" ? "yearly" : "monthly" })
                      }
                      className="h-8 px-3 rounded-lg bg-[var(--fill)] text-[12px] font-medium"
                    >
                      {isAr ? "الخطة:" : "Plan:"} {t.planCode}
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateTenant(t.id, { status: "active", extendDays: 30 })}
                      className="h-8 px-3 rounded-lg bg-[var(--tint-soft)] text-[var(--tint)] text-[12px] font-semibold"
                    >
                      +30 {isAr ? "يوم" : "days"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void updateTenant(t.id, { status: suspended ? "active" : "suspended" })
                      }
                      className={`h-8 px-3 rounded-lg text-[12px] font-semibold flex items-center gap-1 ${
                        suspended
                          ? "bg-[var(--green-soft)] text-[var(--green)]"
                          : "bg-[var(--red-soft)] text-[var(--red)]"
                      }`}
                    >
                      {suspended ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                      {suspended ? (isAr ? "إعادة تفعيل" : "Restore") : isAr ? "إيقاف مؤقت" : "Suspend"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
