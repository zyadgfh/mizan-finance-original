import { Ban, CheckCircle2, Crown, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/finance/i18n";
import {
  adminListTenants,
  adminUpdatePlanPrice,
  adminUpdateTenantSubscription,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import type { AdminTenantOverview, PlanCode, SubscriptionStatus } from "@/lib/tenant/types";

export function SuperAdminScreen() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { isSuperAdmin, plans, refreshWorkspaces } = useTenant();

  const [tenants, setTenants] = useState<AdminTenantOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyPrice, setMonthlyPrice] = useState(
    String(plans.find((p) => p.code === "monthly")?.priceEgp ?? 19),
  );
  const [yearlyPrice, setYearlyPrice] = useState(
    String(plans.find((p) => p.code === "yearly")?.priceEgp ?? 149),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminListTenants();
      setTenants(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر تحميل المستأجرين" : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <div className="bg-[var(--surface)] rounded-2xl p-6 text-center space-y-2 border border-[var(--sep)]">
        <ShieldAlert className="w-8 h-8 text-[var(--red)] mx-auto" />
        <div className="font-bold text-[16px]">{isAr ? "صلاحية Super-Admin مطلوبة" : "Super-Admin Required"}</div>
        <p className="text-[13px] text-[var(--label-3)]">
          {isAr ? "هذا القسم مخصص لمسؤول المنصة فقط." : "This console is restricted to platform administrators."}
        </p>
      </div>
    );
  }

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

  const totalMembers = tenants.reduce((s, t) => s + t.memberCount, 0);
  const totalRecords = tenants.reduce((s, t) => s + t.recordCount, 0);
  const activeCount = tenants.filter((t) => t.subscriptionStatus !== "suspended").length;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[22px] font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-[var(--tint)]" />
            {isAr ? "لوحة تحكم المنصة (Super-Admin)" : "Platform Super-Admin"}
          </h2>
          <p className="text-[12px] text-[var(--label-3)]">
            {isAr ? "إدارة المستأجرين، الخطط الشهرية/السنوية الرمزية، وحالة التفعيل" : "Manage tenants, symbolic billing plans, and status"}
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
          { label: isAr ? "إجمالي المستأجرين" : "Tenants", val: tenants.length },
          { label: isAr ? "النشطون" : "Active", val: activeCount },
          { label: isAr ? "إجمالي الأعضاء" : "Members", val: totalMembers },
          { label: isAr ? "إجمالي السجلات" : "Records", val: totalRecords },
        ].map((k) => (
          <div key={k.label} className="bg-[var(--surface)] rounded-2xl p-3.5 border border-[var(--sep)]">
            <div className="text-[11px] text-[var(--label-3)]">{k.label}</div>
            <div className="text-[22px] font-bold mt-1">{k.val}</div>
          </div>
        ))}
      </div>

      {/* Plan Pricing Editor */}
      <div className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-3">
        <div className="font-bold text-[14px]">
          {isAr ? "تسعير الخطط (شهري / سنوي رمزي بدون قيود مميزات)" : "Symbolic Plan Pricing (No Feature Limits)"}
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

      {/* Tenant Directory */}
      <div className="space-y-2.5">
        {tenants.map((t) => {
          const suspended = t.subscriptionStatus === "suspended";
          return (
            <div key={t.id} className="bg-[var(--surface)] rounded-2xl p-4 border border-[var(--sep)] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-[15px]">{t.name}</div>
                  <div className="text-[12px] text-[var(--label-3)]">
                    <span dir="ltr">/{t.slug}</span> · {t.ownerEmail} · {t.memberCount} {isAr ? "أعضاء" : "members"} ·{" "}
                    {t.recordCount} {isAr ? "سجل" : "records"}
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
        })}
      </div>
    </div>
  );
}
