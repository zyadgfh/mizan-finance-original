import {
  Check,
  Cloud,
  CloudOff,
  Crown,
  HardDrive,
  KeyRound,
  Plus,
  Settings2,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { PillButton, Sheet } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { CURRENCIES, type Currency } from "@/lib/finance/types";
import { useTenant } from "@/lib/tenant/context";
import { formatRoleLabel, formatTenantKindLabel, type TenantKind } from "@/lib/tenant/types";

export function WorkspaceSwitcherSheet({
  open: _open,
  onClose,
}: {
  open?: boolean;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const {
    workspaces,
    activeTenant,
    isSuperAdmin,
    switchTenant,
    createWorkspace,
    acceptInviteCode,
    promoteLocalWorkspace,
  } = useTenant();
  const { frame, openTenant, openAdmin } = useMizan();

  const [tab, setTab] = useState<"list" | "create" | "invite">("list");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<TenantKind>("business");
  const [currency, setCurrency] = useState<Currency>("EGP");
  const [mode, setMode] = useState<"cloud" | "local">("cloud");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(isAr ? "أدخل اسم المساحة" : "Enter workspace name");
      return;
    }
    setBusy(true);
    try {
      const ws = await createWorkspace({ name, slug, kind, baseCurrency: currency, mode });
      toast.success(isAr ? `تم إنشاء «${ws.name}»` : `Created "${ws.name}"`);
      setName("");
      setSlug("");
      setTab("list");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر الإنشاء" : "Failed to create workspace");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setBusy(true);
    try {
      const ws = await acceptInviteCode(inviteCode.trim());
      if (ws) {
        toast.success(isAr ? `انضممت إلى «${ws.name}»` : `Joined "${ws.name}"`);
        setInviteCode("");
        setTab("list");
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "رمز الدعوة غير صالح" : "Invalid invite code");
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async (id: string) => {
    setBusy(true);
    try {
      const ws = await promoteLocalWorkspace(id);
      toast.success(isAr ? `تمت مزامنة «${ws.name}» سحابيًا` : `Promoted "${ws.name}" to cloud`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّرت الترقية السحابية" : "Failed to promote workspace");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={isAr ? "مساحات العمل والمستأجرين" : "Workspaces & Tenants"}
      description={isAr ? "تبديل أو إنشاء أو الانضمام إلى مساحة عمل" : "Switch, create, or join a workspace"}
      container={frame}
      onClose={onClose}
    >
      <div className="space-y-4 px-4">
        <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[var(--fill)]">
          <button
            type="button"
            onClick={() => setTab("list")}
            className={`py-2 text-[13px] font-semibold rounded-xl ${
              tab === "list" ? "bg-[var(--surface)] shadow-sm" : "text-[var(--label-3)]"
            }`}
          >
            {isAr ? "مساحاتي" : "Workspaces"} ({workspaces.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`py-2 text-[13px] font-semibold rounded-xl flex items-center justify-center gap-1 ${
              tab === "create" ? "bg-[var(--surface)] shadow-sm" : "text-[var(--label-3)]"
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            {isAr ? "جديدة" : "New"}
          </button>
          <button
            type="button"
            onClick={() => setTab("invite")}
            className={`py-2 text-[13px] font-semibold rounded-xl flex items-center justify-center gap-1 ${
              tab === "invite" ? "bg-[var(--surface)] shadow-sm" : "text-[var(--label-3)]"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {isAr ? "انضمام" : "Join"}
          </button>
        </div>

        {tab === "list" && (
          <div className="space-y-2.5">
            {workspaces.map((ws) => {
              const selected = activeTenant?.id === ws.id;
              return (
                <div
                  key={ws.id}
                  className={`p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${
                    selected
                      ? "border-[var(--tint)] bg-[var(--tint-soft)]"
                      : "border-[var(--sep)] bg-[var(--surface)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      switchTenant(ws.id);
                      onClose();
                    }}
                    className="flex-1 text-start min-w-0"
                  >
                    <div className="flex items-center gap-2">
                      {ws.mode === "cloud" ? (
                        <Cloud className="w-4 h-4 text-[var(--tint)] shrink-0" />
                      ) : (
                        <HardDrive className="w-4 h-4 text-[var(--orange)] shrink-0" />
                      )}
                      <span className="font-bold text-[15px] truncate">{ws.name}</span>
                      {selected && <Check className="w-4 h-4 text-[var(--tint)] shrink-0" />}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-[var(--label-3)]">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--fill)] text-[var(--label-2)] font-medium">
                        {formatRoleLabel(ws.role, lang)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--fill)]">
                        {formatTenantKindLabel(ws.kind, lang)} · {ws.baseCurrency}
                      </span>
                      <span className="font-mono" dir="ltr">
                        /{ws.slug}
                      </span>
                      {ws.subscriptionStatus === "suspended" && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--red-soft)] text-[var(--red)] font-semibold">
                          {isAr ? "معلّقة" : "Suspended"}
                        </span>
                      )}
                    </div>
                  </button>

                  {ws.mode === "local" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handlePromote(ws.id)}
                      className="px-2.5 py-1.5 rounded-xl bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1 shrink-0"
                      title={isAr ? "رفع للسحابة" : "Sync to Cloud"}
                    >
                      <UploadCloud className="w-3.5 h-3.5 text-[var(--tint)]" />
                      {isAr ? "رفع" : "Cloud"}
                    </button>
                  )}
                </div>
              );
            })}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openTenant();
                }}
                className="h-11 rounded-xl bg-[var(--fill)] text-[13px] font-semibold flex items-center justify-center gap-2"
              >
                <Settings2 className="w-4 h-4 text-[var(--tint)]" />
                {isAr ? "إعدادات المساحة والأعضاء" : "Workspace & Members"}
              </button>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openAdmin();
                  }}
                  className="h-11 rounded-xl bg-[var(--tint-soft)] text-[var(--tint)] text-[13px] font-semibold flex items-center justify-center gap-2"
                >
                  <Crown className="w-4 h-4" />
                  {isAr ? "لوحة Super-Admin" : "Super-Admin Console"}
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "create" && (
          <form onSubmit={handleCreate} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-[var(--label-2)]">
                {isAr ? "اسم المساحة" : "Workspace Name"}
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isAr ? "مثال: حسابات العائلة / شركة النور" : "e.g. Family Budget / Acme LLC"}
                className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[15px]"
              />
            </label>

            {mode === "cloud" && (
              <label className="block space-y-1">
                <span className="text-[13px] font-medium text-[var(--label-2)]">
                  {isAr ? "المعرّف بالرابط (Slug اختياري)" : "URL Slug (Optional)"}
                </span>
                <input
                  type="text"
                  dir="ltr"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  placeholder="acme-ledger"
                  className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px] font-mono"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[13px] font-medium text-[var(--label-2)]">
                  {isAr ? "النوع" : "Kind"}
                </span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as TenantKind)}
                  className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px]"
                >
                  <option value="personal">{isAr ? "شخصي" : "Personal"}</option>
                  <option value="family">{isAr ? "عائلي" : "Family"}</option>
                  <option value="business">{isAr ? "نشاط تجاري" : "Business"}</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[13px] font-medium text-[var(--label-2)]">
                  {isAr ? "العملة الأساسية" : "Base Currency"}
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[14px]"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("cloud")}
                className={`p-3 rounded-xl border text-start ${
                  mode === "cloud" ? "border-[var(--tint)] bg-[var(--tint-soft)]" : "border-[var(--sep)]"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-[13px]">
                  <Cloud className="w-4 h-4 text-[var(--tint)]" />
                  {isAr ? "سحابية مشتركة" : "Cloud Shared"}
                </div>
                <p className="text-[11px] text-[var(--label-3)] mt-0.5">
                  {isAr ? "تعمل أوفلاين وتدعم دعوة فريقك" : "Offline-first + team invites"}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("local")}
                className={`p-3 rounded-xl border text-start ${
                  mode === "local" ? "border-[var(--orange)] bg-[var(--orange)]/10" : "border-[var(--sep)]"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-[13px]">
                  <CloudOff className="w-4 h-4 text-[var(--orange)]" />
                  {isAr ? "محلية على الجهاز" : "Local On-Device"}
                </div>
                <p className="text-[11px] text-[var(--label-3)] mt-0.5">
                  {isAr ? "لا تُرفع للسحابة إلا بطلبك" : "Private to this device only"}
                </p>
              </button>
            </div>

            <PillButton type="submit" disabled={busy} className="w-full h-11">
              {busy ? (isAr ? "جارٍ الإنشاء…" : "Creating…") : isAr ? "إنشاء المساحة" : "Create Workspace"}
            </PillButton>
          </form>
        )}

        {tab === "invite" && (
          <form onSubmit={handleJoin} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-[var(--label-2)]">
                {isAr ? "كود الدعوة" : "Invite Code"}
              </span>
              <input
                type="text"
                required
                dir="ltr"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="MZN-XXXX-YYYY"
                className="w-full h-11 px-3 rounded-xl bg-[var(--fill)] text-[15px] font-mono uppercase"
              />
            </label>
            <PillButton type="submit" disabled={busy} className="w-full h-11">
              <ShieldCheck className="w-4 h-4" />
              {busy ? (isAr ? "جارٍ الانضمام…" : "Joining…") : isAr ? "قبول الدعوة والدخول" : "Accept & Join"}
            </PillButton>
          </form>
        )}
      </div>
    </Sheet>
  );
}
