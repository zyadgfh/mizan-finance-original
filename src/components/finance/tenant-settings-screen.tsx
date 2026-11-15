import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  CreditCard,
  History,
  KeyRound,
  LogOut,
  RefreshCw,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { CURRENCIES, type Currency } from "@/lib/finance/types";
import {
  createTenantInvite,
  fetchTenantAuditLogs,
  fetchTenantMembers,
  listTenantInvites,
  removeTenantMember,
  revokeTenantInvite,
  updateMemberRole,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import {
  canAdminRole,
  formatRoleLabel,
  formatTenantKindLabel,
  type AuditLogItem,
  type PlanCode,
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
      const [m, l] = await Promise.all([
        fetchTenantMembers(activeTenant.id),
        fetchTenantAuditLogs(activeTenant.id),
      ]);
      setMembers(m);
      setLogs(l);
      if (canAdminRole(activeTenant.role)) {
        const inv = await listTenantInvites(activeTenant.id);
        setInvites(inv.filter((i) => !i.revokedAt));
      } else {
        setInvites([]);
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
    try {
      await navigator.clipboard.writeText(webUrl);
      toast.success(isAr ? "تم نسخ رابط وكود الدعوة" : "Invite link copied");
    } catch {
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
              {isAr ? "عمليات مرفوضة من الخادم" : "Server-Rejected Offline Operations"}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-[15px]">
                <CreditCard className="w-4 h-4 text-[var(--tint)]" />
                {isAr ? "الباقة الحالية" : "Current Subscription"}
              </div>
              <span className="px-2.5 py-1 rounded-full bg-[var(--tint-soft)] text-[var(--tint)] text-[12px] font-semibold">
                {activeTenant.subscriptionStatus === "trialing"
                  ? isAr
                    ? "فترة تجريبية"
                    : "Trialing"
                  : activeTenant.subscriptionStatus === "active"
                    ? isAr
                      ? "نشطة"
                      : "Active"
                    : activeTenant.subscriptionStatus === "suspended"
                      ? isAr
                        ? "معلّقة"
                        : "Suspended"
                      : activeTenant.subscriptionStatus}
              </span>
            </div>
            <p className="text-[12px] text-[var(--label-2)]">
              {isAr
                ? "جميع المميزات متاحة بالكامل في كلتا الخطتين بدون أي قيود على المعاملات أو الأعضاء أو المساحات. فقط اختر الدفع الشهري أو السنوي الرمزي."
                : "All features are unlocked on every plan with zero limits on records or members. Simply pick symbolic Monthly or Yearly billing."}
            </p>
            <p className="text-[11px] text-[var(--label-3)]">
              {isAr ? "تنتهي الفترة في: " : "Current period ends: "}
              {new Date(activeTenant.currentPeriodEnd).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plans.map((p) => {
              const current = activeTenant.planCode === p.code;
              return (
                <div
                  key={p.code}
                  className={`p-4 rounded-2xl border space-y-3 ${
                    current ? "border-[var(--tint)] bg-[var(--tint-soft)]" : "border-[var(--sep)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[15px]">{isAr ? p.nameAr : p.nameEn}</span>
                    {current && <Check className="w-4 h-4 text-[var(--tint)]" />}
                  </div>
                  <div className="text-[24px] font-bold">
                    {p.priceEgp} <span className="text-[13px] font-medium text-[var(--label-3)]">{isAr ? "ج.م" : "EGP"} / {p.billingInterval === "year" ? (isAr ? "سنة" : "yr") : (isAr ? "شهر" : "mo")}</span>
                  </div>
                  {isCloud && isAdmin && (
                    <PillButton
                      type="button"
                      disabled={busy || activeTenant.subscriptionStatus === "suspended"}
                      onClick={() => void handlePlanSelect(p.code)}
                      className="w-full h-10 text-[13px]"
                    >
                      {current
                        ? isAr
                          ? "تجديد / تمديد هذه الخطة"
                          : "Renew Plan"
                        : isAr
                          ? "تفعيل هذه الخطة"
                          : "Switch to Plan"}
                    </PillButton>
                  )}
                </div>
              );
            })}
          </div>
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
