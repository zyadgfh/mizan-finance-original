import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  History,
  ImagePlus,
  KeyRound,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  UserMinus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { CURRENCIES, type Currency } from "@/lib/finance/types";
import { copyTextSafe } from "@/lib/mobile-safe";
import {
  createTenantInvite,
  fetchPlatformBillingInfo,
  fetchTenantAuditLogs,
  fetchTenantMembers,
  listPaymentRequests,
  listTenantInvites,
  removeTenantMember,
  revokeTenantInvite,
  submitRenewalPaymentWithProof,
  updateMemberRole,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import { compressTransferProofImage } from "@/lib/tenant/identity";
import {
  canAdminRole,
  formatPlanLabel,
  formatRoleLabel,
  formatSubscriptionStatusLabel,
  formatTenantKindLabel,
  getRemainingSubscriptionDays,
  type AuditLogItem,
  type PaymentMethod,
  type PaymentRequestItem,
  type PlanCode,
  type PlatformBillingInfo,
  type TenantInvite,
  type TenantKind,
  type TenantMember,
  type TenantRole,
} from "@/lib/tenant/types";

export function TenantSettingsScreen() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { back } = useMizan();
  const {
    user,
    isSuperAdmin,
    activeTenant,
    plans,
    syncStatus,
    pendingOpsCount,
    rejectedSyncItems,
    lastSyncedAt,
    syncNow,
    updateActiveWorkspace,
    activatePlan,
    refreshWorkspaces,
    dismissRejectedSync,
    signOut,
  } = useTenant();

  const [section, setSection] = useState<"general" | "members" | "billing" | "audit">("general");
  const [name, setName] = useState(activeTenant?.name ?? "");
  const [slug, setSlug] = useState(activeTenant?.slug ?? "");
  const [kind, setKind] = useState<TenantKind>(activeTenant?.kind ?? "personal");
  const [currency, setCurrency] = useState<Currency>(activeTenant?.baseCurrency ?? "EGP");

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [invites, setInvites] = useState<TenantInvite[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestItem[]>([]);
  const [billingInfo, setBillingInfo] = useState<PlatformBillingInfo | null>(null);
  const [selectedPayPlan, setSelectedPayPlan] = useState<PlanCode>(activeTenant?.planCode ?? "monthly");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("instapay");
  const [paySenderHandle, setPaySenderHandle] = useState("");
  const [payProofDataUrl, setPayProofDataUrl] = useState<string | null>(null);
  const [compressingProof, setCompressingProof] = useState(false);
  const [inviteRole, setInviteRole] = useState<Exclude<TenantRole, "owner">>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const isCloud = activeTenant?.mode === "cloud";
  const isAdmin = canAdminRole(activeTenant?.role);

  useEffect(() => {
    if (!activeTenant) return;
    setName(activeTenant.name);
    setSlug(activeTenant.slug);
    setKind(activeTenant.kind);
    setCurrency(activeTenant.baseCurrency);
  }, [activeTenant]);

  const loadRemoteData = useCallback(async () => {
    if (!activeTenant || activeTenant.mode !== "cloud") return;
    try {
      const [m, l, bInfo] = await Promise.all([
        fetchTenantMembers(activeTenant.id),
        fetchTenantAuditLogs(activeTenant.id),
        fetchPlatformBillingInfo().catch(() => null),
      ]);
      setMembers(m);
      setLogs(l);
      if (bInfo) setBillingInfo(bInfo);
      if (canAdminRole(activeTenant.role)) {
        const [inv, reqs] = await Promise.all([
          listTenantInvites(activeTenant.id),
          listPaymentRequests(activeTenant.id).catch(() => []),
        ]);
        setInvites(inv.filter((i) => !i.revokedAt));
        setPaymentRequests(reqs);
      } else {
        setInvites([]);
        setPaymentRequests([]);
      }
    } catch {
      /* offline */
    }
  }, [activeTenant]);

  useEffect(() => {
    void loadRemoteData();
  }, [loadRemoteData]);

  if (!activeTenant) return null;

  const saveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    try {
      await updateActiveWorkspace({ name, slug, kind, baseCurrency: currency });
      toast.success(isAr ? "تم حفظ إعدادات المساحة" : "Workspace settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر الحفظ" : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isCloud || !isAdmin) return;
    setBusy(true);
    try {
      const inv = await createTenantInvite({
        tenantId: activeTenant.id,
        createdBy: user.id,
        role: inviteRole,
        email: inviteEmail || undefined,
      });
      setInvites((prev) => [inv, ...prev]);
      setInviteEmail("");
      toast.success(isAr ? `تم إنشاء كود الدعوة: ${inv.inviteCode}` : `Invite created: ${inv.inviteCode}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر إنشاء الدعوة" : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  };

  const copyInviteText = async (code: string) => {
    const webUrl =
      typeof window !== "undefined" && window.location.origin.startsWith("http")
        ? `${window.location.origin}/invite/${code}`
        : code;
    const copied = await copyTextSafe(webUrl);
    if (copied) {
      toast.success(isAr ? "تم نسخ رابط وكود الدعوة" : "Invite link copied");
    } else {
      toast.info(code);
    }
  };

  const handleRoleChange = async (memberUserId: string, nextRole: Exclude<TenantRole, "owner">) => {
    try {
      await updateMemberRole(activeTenant.id, memberUserId, nextRole);
      setMembers((prev) => prev.map((m) => (m.userId === memberUserId ? { ...m, role: nextRole } : m)));
      toast.success(isAr ? "تم تحديث الصلاحية" : "Role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر تعديل الصلاحية" : "Role change failed");
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    try {
      await removeTenantMember(activeTenant.id, memberUserId);
      setMembers((prev) => prev.filter((m) => m.userId !== memberUserId));
      if (memberUserId === user?.id) {
        await refreshWorkspaces();
        back();
      }
      toast.success(isAr ? "تمت إزالة العضو" : "Member removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّرت الإزالة" : "Remove failed");
    }
  };

  const handlePlanSelect = async (code: PlanCode) => {
    if (!isAdmin || !isCloud) return;
    if (!isSuperAdmin) {
      setSelectedPayPlan(code);
      return;
    }
    setBusy(true);
    try {
      await activatePlan(code);
      toast.success(isAr ? "تم تفعيل الخطة بنجاح" : "Plan updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر تحديث الخطة" : "Plan update failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSelectRenewalProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressingProof(true);
    try {
      const compressed = await compressTransferProofImage(file);
      setPayProofDataUrl(compressed);
      toast.success(isAr ? "تم إرفاق صورة التحويل" : "Transfer screenshot attached");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCompressingProof(false);
      e.target.value = "";
    }
  };

  const handleSubmitPaymentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !isCloud) return;
    if (!paySenderHandle.trim() || paySenderHandle.trim().length < 3) {
      toast.error(
        payMethod === "instapay"
          ? isAr
            ? "أدخل اليوزر نيم على إنستا باي أو الرقم الذي تم منه التحويل"
            : "Enter InstaPay username or sender phone"
          : isAr
            ? "أدخل الرقم الذي تم منه التحويل"
            : "Enter sender phone number",
      );
      return;
    }
    if (!payProofDataUrl) {
      toast.error(isAr ? "يرجى رفع صورة التحويل أولاً" : "Please upload transfer screenshot");
      return;
    }
    setBusy(true);
    try {
      const req = await submitRenewalPaymentWithProof({
        tenantId: activeTenant.id,
        planCode: selectedPayPlan,
        paymentMethod: payMethod,
        senderHandle: paySenderHandle.trim(),
        proofDataUrl: payProofDataUrl,
      });
      setPaymentRequests((prev) => [req, ...prev]);
      setPaySenderHandle("");
      setPayProofDataUrl(null);
      toast.success(
        isAr
          ? "تم إرسال طلب التجديد وصورة التحويل لمالك المنصة للمراجعة والتفعيل"
          : "Payment proof submitted for owner approval",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : isAr ? "تعذّر إرسال طلب الدفع" : "Submission failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--tint)]" />
            {activeTenant.name}
          </h2>
          <p className="text-[12px] text-[var(--label-3)]">
            {formatTenantKindLabel(activeTenant.kind, lang)} · {formatRoleLabel(activeTenant.role, lang)} ·{" "}
            <span dir="ltr">/t/{activeTenant.slug}</span>
          </p>
        </div>
        {isCloud && (
          <button
            type="button"
            onClick={() => void syncNow()}
            className="h-9 px-3 rounded-full bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === "syncing" ? "animate-spin" : ""}`} />
            {isAr ? "مزامنة" : "Sync"} ({pendingOpsCount})
          </button>
        )}
      </div>

      {/* Sync rejection warnings */}
      {rejectedSyncItems.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-[var(--red-soft)] border border-[var(--red)]/30 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[var(--red)] font-bold text-[13px]">
              <AlertTriangle className="w-4 h-4" />
              {isAr ? "عمليات مرفوضة أثناء المزامنة" : "Rejected Offline Operations"}
            </div>
            <button type="button" onClick={dismissRejectedSync} className="text-[11px] underline">
              {isAr ? "إخفاء" : "Dismiss"}
            </button>
          </div>
          {rejectedSyncItems.slice(0, 3).map((item, idx) => (
            <div key={idx} className="text-[12px] text-[var(--label-2)]">
              • {item.entityType} ({item.entityId.slice(0, 8)}): {item.error}
            </div>
          ))}
        </div>
      )}

      {/* Section Tabs */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-[var(--fill)]">
        {[
          { id: "general", label: isAr ? "عام" : "General" },
          { id: "members", label: isAr ? "الأعضاء" : "Members" },
          { id: "billing", label: isAr ? "الاشتراك" : "Plan" },
          { id: "audit", label: isAr ? "السجل" : "Audit" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id as typeof section)}
            className={`py-2 rounded-xl text-[12px] font-semibold ${
              section === t.id ? "bg-[var(--surface)] shadow-sm" : "text-[var(--label-3)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "general" && (
        <form onSubmit={saveGeneral} className="bg-[var(--surface)] rounded-2xl p-4 space-y-3.5 border border-[var(--sep)]">
          <label className="block space-y-1">
            <span className="text-[13px] font-medium text-[var(--label-2)]">{isAr ? "اسم المساحة" : "Workspace Name"}</span>
            <input
              type="text"
              disabled={!isAdmin}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[15px] disabled:opacity-60"
            />
          </label>
          {isCloud && (
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-[var(--label-2)]">{isAr ? "رابط المساحة (Slug)" : "URL Slug"}</span>
              <input
                type="text"
                dir="ltr"
                disabled={!isAdmin}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px] font-mono disabled:opacity-60"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-[var(--label-2)]">{isAr ? "نوع المساحة" : "Type"}</span>
              <select
                disabled={!isAdmin}
                value={kind}
                onChange={(e) => setKind(e.target.value as TenantKind)}
                className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px] disabled:opacity-60"
              >
                <option value="personal">{isAr ? "شخصي" : "Personal"}</option>
                <option value="family">{isAr ? "عائلي" : "Family"}</option>
                <option value="business">{isAr ? "نشاط تجاري" : "Business"}</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-[var(--label-2)]">{isAr ? "العملة" : "Currency"}</span>
              <select
                disabled={!isAdmin}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px] disabled:opacity-60"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lastSyncedAt && (
            <p className="text-[12px] text-[var(--label-3)]">
              {isAr ? "آخر مزامنة سحابية: " : "Last cloud sync: "}
              {new Date(lastSyncedAt).toLocaleTimeString(isAr ? "ar-EG" : "en-US")}
            </p>
          )}
          {isAdmin && (
            <PillButton type="submit" disabled={busy} className="w-full h-11">
              {busy ? (isAr ? "جارٍ الحفظ…" : "Saving…") : isAr ? "حفظ الإعدادات" : "Save Settings"}
            </PillButton>
          )}

          <div className="pt-2 border-t border-[var(--sep)] flex items-center justify-between">
            <span className="text-[12px] text-[var(--label-3)]">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-[13px] font-semibold text-[var(--red)] flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              {isAr ? "تسجيل الخروج ومسح الكاش" : "Sign Out & Clear Cache"}
            </button>
          </div>
        </form>
      )}

      {section === "members" && (
        <div className="space-y-3">
          {!isCloud ? (
            <div className="bg-[var(--surface)] rounded-2xl p-4 text-[13px] text-[var(--label-2)] border border-[var(--sep)]">
              {isAr
                ? "هذه مساحة محلية على الجهاز فقط. قم بترقيتها إلى السحابة من مبدّل المساحات لدعوة الأعضاء."
                : "This is a local-only workspace. Promote it to Cloud in the Workspace Switcher to invite members."}
            </div>
          ) : (
            <>
              <div className="bg-[var(--surface)] rounded-2xl p-4 space-y-2.5 border border-[var(--sep)]">
                <div className="flex items-center gap-2 font-bold text-[14px]">
                  <Users className="w-4 h-4 text-[var(--tint)]" />
                  {isAr ? "أعضاء المساحة" : "Workspace Members"} ({members.length})
                </div>
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between gap-2 py-2 border-t border-[var(--sep)] first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[14px] truncate">{m.displayName}</div>
                      <div className="text-[11px] text-[var(--label-3)] truncate">{m.email}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.role === "owner" || !isAdmin ? (
                        <span className="px-2.5 py-1 rounded-full bg-[var(--fill)] text-[11px] font-semibold">
                          {formatRoleLabel(m.role, lang)}
                        </span>
                      ) : (
                        <>
                          <select
                            value={m.role}
                            onChange={(e) =>
                              void handleRoleChange(m.userId, e.target.value as Exclude<TenantRole, "owner">)
                            }
                            className="h-8 px-2 rounded-lg bg-[var(--fill)] text-[12px] font-medium"
                          >
                            {activeTenant.role === "owner" && (
                              <option value="admin">{formatRoleLabel("admin", lang)}</option>
                            )}
                            <option value="member">{formatRoleLabel("member", lang)}</option>
                            <option value="viewer">{formatRoleLabel("viewer", lang)}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(m.userId)}
                            className="p-1.5 rounded-lg text-[var(--red)] hover:bg-[var(--red-soft)]"
                            aria-label={isAr ? "إزالة العضو" : "Remove member"}
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {isAdmin && (
                <form
                  onSubmit={handleCreateInvite}
                  className="bg-[var(--surface)] rounded-2xl p-4 space-y-3 border border-[var(--sep)]"
                >
                  <div className="flex items-center gap-2 font-bold text-[14px]">
                    <KeyRound className="w-4 h-4 text-[var(--tint)]" />
                    {isAr ? "إنشاء دعوة جديدة" : "Create Invite Link / Code"}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Exclude<TenantRole, "owner">)}
                      className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                    >
                      <option value="member">{formatRoleLabel("member", lang)}</option>
                      <option value="viewer">{formatRoleLabel("viewer", lang)}</option>
                      <option value="admin">{formatRoleLabel("admin", lang)}</option>
                    </select>
                    <input
                      type="email"
                      dir="ltr"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder={isAr ? "بريد محدد (اختياري)" : "Specific email (optional)"}
                      className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                    />
                  </div>
                  <PillButton type="submit" disabled={busy} className="w-full h-10 text-[13px]">
                    {isAr ? "توليد كود ورابط دعوة" : "Generate Invite Code"}
                  </PillButton>

                  {invites.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[var(--sep)]">
                      {invites.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--fill)]"
                        >
                          <div>
                            <div className="font-mono font-bold text-[13px]" dir="ltr">
                              {inv.inviteCode}
                            </div>
                            <div className="text-[11px] text-[var(--label-3)]">
                              {formatRoleLabel(inv.role, lang)} · {inv.usesCount}/{inv.maxUses}{" "}
                              {inv.email ? `· ${inv.email}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void copyInviteText(inv.inviteCode)}
                              className="p-2 rounded-lg bg-[var(--surface)]"
                              aria-label={isAr ? "نسخ الدعوة" : "Copy invite"}
                            >
                              <Copy className="w-3.5 h-3.5 text-[var(--tint)]" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void revokeTenantInvite(inv.id).then(() =>
                                  setInvites((p) => p.filter((x) => x.id !== inv.id)),
                                )
                              }
                              className="p-2 rounded-lg text-[var(--red)]"
                              aria-label={isAr ? "إلغاء الدعوة" : "Revoke invite"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </form>
              )}
            </>
          )}
        </div>
      )}

      {section === "billing" && (
        <div className="space-y-3">
          <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 font-bold text-[15px]">
                <CreditCard className="w-4 h-4 text-[var(--tint)]" />
                {isAr ? "حالة الاشتراك الحالي" : "Current Subscription"}
              </div>
              <span className="px-2.5 py-1 rounded-full bg-[var(--tint-soft)] text-[var(--tint)] text-[12px] font-semibold">
                {formatSubscriptionStatusLabel(activeTenant.subscriptionStatus, lang)}
              </span>
            </div>
            <p className="text-[12px] text-[var(--label-2)]">
              {isAr
                ? "جميع المميزات متاحة بالكامل في كل الباقات. عند انتهاء مدة الاشتراك يتوقف الحساب تلقائياً لحين التجديد مع حفظ كامل بياناتك."
                : "All features are unlocked on every package. When the period ends, access pauses automatically until renewed while keeping all data safe."}
            </p>
            <div className="flex items-center justify-between text-[12px] pt-1">
              <span className="text-[var(--label-3)]">
                {isAr ? "ينتهي الاشتراك في: " : "Expires on: "}
                <strong className="text-[var(--label)]">
                  {new Date(activeTenant.currentPeriodEnd).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                </strong>
              </span>
              <span className="font-bold text-[var(--tint)]">
                {(() => {
                  const days = getRemainingSubscriptionDays(activeTenant.currentPeriodEnd);
                  return days > 0
                    ? isAr
                      ? `متبقي ${days} يوم`
                      : `${days} days left`
                    : isAr
                      ? "منتهي"
                      : "Expired";
                })()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {plans.map((p) => {
              const current = activeTenant.planCode === p.code;
              const selected = selectedPayPlan === p.code;
              return (
                <div
                  key={p.code}
                  className={`p-3.5 rounded-2xl border space-y-2.5 ${
                    selected
                      ? "border-[var(--tint)] bg-[var(--tint-soft)]"
                      : "border-[var(--sep)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[14px]">{formatPlanLabel(p.code, lang)}</span>
                    {current && <Check className="w-4 h-4 text-[var(--tint)]" />}
                  </div>
                  <div className="text-[22px] font-extrabold">
                    {p.priceEgp}{" "}
                    <span className="text-[12px] font-medium text-[var(--label-3)]">{isAr ? "ج.م" : "EGP"}</span>
                  </div>
                  {isCloud && isAdmin && (
                    <PillButton
                      type="button"
                      disabled={busy}
                      onClick={() => void handlePlanSelect(p.code)}
                      className="w-full h-9 text-[12px] justify-center"
                    >
                      {isSuperAdmin
                        ? isAr
                          ? "تفعيل فوري (المالك)"
                          : "Instant Activate"
                        : selected
                          ? isAr
                            ? "محددة للتجديد ✓"
                            : "Selected ✓"
                          : isAr
                            ? "اختيار للتجديد"
                            : "Select"}
                    </PillButton>
                  )}
                </div>
              );
            })}
          </div>

          {isCloud && isAdmin && (
            <form
              onSubmit={handleSubmitPaymentRequest}
              className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3"
            >
              <div className="font-bold text-[14px]">
                {isAr
                  ? "تجديد الاشتراك ورفع إيصال التحويل (إنستا باي / فودافون كاش)"
                  : "Renew Subscription & Upload Transfer Proof"}
              </div>
              <p className="text-[12px] text-[var(--label-2)] whitespace-pre-line">
                {billingInfo
                  ? isAr
                    ? billingInfo.instructionsAr
                    : billingInfo.instructionsEn
                  : isAr
                    ? "حوّل قيمة الباقة المختارة ثم أدخل الرقم المحوّل منه أو يوزر إنستا باي وارفع صورة التحويل."
                    : "Transfer the package amount, enter your sender phone or InstaPay handle, and upload the screenshot."}
              </p>

              {(billingInfo?.instapayHandle || billingInfo?.vodafoneCashNumber || billingInfo?.bankDetails) && (
                <div className="p-3 rounded-xl bg-[var(--fill)] text-[12px] space-y-1 font-mono" dir="ltr">
                  {billingInfo.instapayHandle && (
                    <div>
                      InstaPay: <strong>{billingInfo.instapayHandle}</strong>
                    </div>
                  )}
                  {billingInfo.vodafoneCashNumber && (
                    <div>
                      Vodafone Cash: <strong>{billingInfo.vodafoneCashNumber}</strong>
                    </div>
                  )}
                  {billingInfo.bankDetails && (
                    <div>
                      Bank: <strong>{billingInfo.bankDetails}</strong>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={selectedPayPlan}
                  onChange={(e) => setSelectedPayPlan(e.target.value as PlanCode)}
                  className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                >
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {formatPlanLabel(p.code, lang)} ({p.priceEgp} {isAr ? "ج.م" : "EGP"})
                    </option>
                  ))}
                </select>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px]"
                >
                  <option value="instapay">{isAr ? "إنستا باي (InstaPay)" : "InstaPay"}</option>
                  <option value="vodafone_cash">{isAr ? "فودافون كاش (Vodafone Cash)" : "Vodafone Cash"}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                  {payMethod === "instapay"
                    ? isAr
                      ? "اليوزر نيم على إنستا باي أو الرقم الذي تم منه التحويل *"
                      : "InstaPay Username or Sender Number *"
                    : isAr
                      ? "الرقم الذي تم منه التحويل *"
                      : "Sender Phone Number *"}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={paySenderHandle}
                  onChange={(e) => setPaySenderHandle(e.target.value)}
                  placeholder={payMethod === "instapay" ? "username@instapay / 010xxxxxxxx" : "010xxxxxxxx"}
                  className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px] font-mono"
                  required
                />
              </div>

              {!payProofDataUrl ? (
                <label
                  className={`relative w-full py-4 px-3 rounded-2xl border-2 border-dashed border-[var(--sep)] bg-[var(--fill)] flex flex-col items-center gap-1 cursor-pointer active:opacity-85 ${
                    compressingProof ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                    disabled={compressingProof}
                    onChange={(e) => void handleSelectRenewalProof(e)}
                    className="sr-only"
                  />
                  <ImagePlus className="w-6 h-6 text-[var(--tint)]" />
                  <span className="text-[12px] font-bold">
                    {compressingProof
                      ? isAr
                        ? "جارٍ تجهيز الصورة…"
                        : "Processing…"
                      : isAr
                        ? "ارفع صورة إيصال التحويل *"
                        : "Upload Transfer Screenshot *"}
                  </span>
                </label>
              ) : (
                <div className="p-2.5 rounded-2xl bg-[var(--fill)] border border-[var(--tint)] space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--green)] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isAr ? "تم إرفاق صورة التحويل" : "Screenshot attached"}
                    </span>
                    <label className="relative px-2.5 py-1 rounded bg-[var(--surface)] font-semibold flex items-center gap-1 cursor-pointer active:opacity-80">
                      <input
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                        disabled={compressingProof}
                        onChange={(e) => void handleSelectRenewalProof(e)}
                        className="sr-only"
                      />
                      <Upload className="w-3 h-3" />
                      <span>{isAr ? "تغيير" : "Replace"}</span>
                    </label>
                  </div>
                  <img src={payProofDataUrl} alt="Transfer proof" className="w-full max-h-40 object-contain rounded-xl" />
                </div>
              )}

              <PillButton
                type="submit"
                disabled={busy || compressingProof}
                className="w-full h-11 text-[13px] justify-center"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {busy
                    ? isAr
                      ? "جارٍ الإرسال..."
                      : "Submitting..."
                    : isAr
                      ? "تم الدفع — إرسال طلب التجديد للمالك"
                      : "Payment Sent — Submit Renewal"}
                </span>
              </PillButton>

              {paymentRequests.length > 0 && (
                <div className="pt-2 border-t border-[var(--sep)] space-y-2">
                  <div className="text-[12px] font-semibold text-[var(--label-2)]">
                    {isAr ? "سجل طلبات الاشتراك والتجديد" : "Subscription Requests History"}
                  </div>
                  {paymentRequests.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--fill)] text-[12px]"
                    >
                      <div>
                        <div className="font-semibold">
                          {formatPlanLabel(r.planCode, lang)} · {r.amountEgp} {isAr ? "ج.م" : "EGP"}
                        </div>
                        <div className="text-[11px] text-[var(--label-3)] font-mono" dir="ltr">
                          {r.senderHandle || r.referenceCode} ·{" "}
                          {new Date(r.createdAt).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          r.status === "approved"
                            ? "bg-[var(--green-soft)] text-[var(--green)]"
                            : r.status === "rejected"
                              ? "bg-[var(--red-soft)] text-[var(--red)]"
                              : "bg-[var(--tint-soft)] text-[var(--tint)]"
                        }`}
                      >
                        {r.status === "pending"
                          ? isAr
                            ? "قيد المراجعة"
                            : "Pending"
                          : r.status === "approved"
                            ? isAr
                              ? "مقبول ومفعّل"
                              : "Approved"
                            : isAr
                              ? "مرفوض"
                              : "Rejected"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {section === "audit" && (
        <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-2.5">
          <div className="flex items-center gap-2 font-bold text-[14px]">
            <History className="w-4 h-4 text-[var(--tint)]" />
            {isAr ? "سجل نشاط المساحة" : "Workspace Audit Log"}
          </div>
          {logs.length === 0 ? (
            <p className="text-[13px] text-[var(--label-3)]">
              {isAr ? "لا توجد أحداث مسجلة بعد" : "No audit logs recorded yet"}
            </p>
          ) : (
            logs.map((item) => (
              <div key={item.id} className="py-2 border-t border-[var(--sep)] first:border-t-0 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{item.actorName}</span>
                  <span className="text-[11px] text-[var(--label-3)]">
                    {new Date(item.createdAt).toLocaleString(isAr ? "ar-EG" : "en-US")}
                  </span>
                </div>
                <div className="text-[12px] text-[var(--label-2)] mt-0.5">{item.summary}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
