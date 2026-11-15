import { Building2, Globe, KeyRound, Lock, LogIn, Mail, Scale, Sparkles, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { updateUiPrefs } from "@/lib/finance/prefs";
import {
  signInWithEmailPassword,
  signInWithGoogleOAuth,
  signUpWithEmailPassword,
} from "@/lib/tenant/api";
import { PENDING_INVITE_KEY } from "@/lib/tenant/context";

export function AuthScreen({
  initialInviteCode,
  onSignedIn,
}: {
  initialInviteCode?: string;
  onSignedIn?: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState(
    initialInviteCode ??
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PENDING_INVITE_KEY) ?? "" : ""),
  );
  const [busy, setBusy] = useState(false);
  const [showInviteField, setShowInviteField] = useState(Boolean(initialInviteCode));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error(isAr ? "أدخل البريد الإلكتروني وكلمة المرور" : "Enter email and password");
      return;
    }
    if (inviteCode.trim() && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_INVITE_KEY, inviteCode.trim().toUpperCase());
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signInWithEmailPassword(email, password);
        toast.success(isAr ? "تم تسجيل الدخول بنجاح" : "Signed in successfully");
      } else {
        const res = await signUpWithEmailPassword(email, password, displayName);
        if (res.needsConfirmation) {
          toast.info(
            isAr
              ? "تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول"
              : "Check your email to confirm your account, then sign in",
          );
        } else {
          toast.success(isAr ? "تم إنشاء الحساب وتجهيز مساحتك" : "Account created and workspace ready");
        }
      }
      onSignedIn?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "فشل المصادقة" : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (inviteCode.trim() && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_INVITE_KEY, inviteCode.trim().toUpperCase());
    }
    setBusy(true);
    try {
      await signInWithGoogleOAuth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر الدخول بـ Google" : "Google sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[var(--surround)] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[var(--surface)] rounded-[28px] border border-[var(--sep)] shadow-[0_24px_60px_rgba(0,0,0,0.08)] p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--tint-soft)] flex items-center justify-center">
              <Scale className="w-6 h-6 text-[var(--tint)]" strokeWidth={2.1} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">
                {isAr ? "ميزان متعدد المساحات" : "Mizan Multi-Tenant"}
              </h1>
              <p className="text-[12px] text-[var(--label-3)]">
                {isAr
                  ? "دفتر مالي مشترك معزول، يعمل أوفلاين ويزامن فور الاتصال"
                  : "Isolated multi-workspace ledger, offline-first with cloud sync"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateUiPrefs({ language: isAr ? "en" : "ar" })}
            className="h-9 px-3 rounded-full bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1.5"
            aria-label={isAr ? "Switch to English" : "التبديل للعربية"}
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            {isAr ? "EN" : "AR"}
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-[var(--fill)]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            onClick={() => setMode("signin")}
            className={`py-2 text-[14px] font-semibold rounded-xl transition ${
              mode === "signin" ? "bg-[var(--surface)] shadow-sm text-[var(--label)]" : "text-[var(--label-3)]"
            }`}
          >
            {isAr ? "تسجيل الدخول" : "Sign In"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => setMode("signup")}
            className={`py-2 text-[14px] font-semibold rounded-xl transition ${
              mode === "signup" ? "bg-[var(--surface)] shadow-sm text-[var(--label)]" : "text-[var(--label-3)]"
            }`}
          >
            {isAr ? "حساب جديد" : "Create Account"}
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[var(--label-2)]">
                {isAr ? "الاسم الظاهر للفريق" : "Display Name"}
              </span>
              <div className="relative">
                <UserPlus className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={isAr ? "مثال: زياد جمال" : "e.g. Zyad Gamal"}
                  className="w-full h-11 ps-10 pe-3 rounded-xl bg-[var(--fill)] text-[15px] outline-none focus:ring-2 focus:ring-[var(--tint)]"
                />
              </div>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-[var(--label-2)]">
              {isAr ? "البريد الإلكتروني" : "Email Address"}
            </span>
            <div className="relative">
              <Mail className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full h-11 ps-10 pe-3 rounded-xl bg-[var(--fill)] text-[15px] outline-none focus:ring-2 focus:ring-[var(--tint)]"
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-[var(--label-2)]">
              {isAr ? "كلمة المرور" : "Password"}
            </span>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
              <input
                type="password"
                required
                minLength={6}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 ps-10 pe-3 rounded-xl bg-[var(--fill)] text-[15px] outline-none focus:ring-2 focus:ring-[var(--tint)]"
              />
            </div>
          </label>

          {showInviteField ? (
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[var(--label-2)]">
                {isAr ? "كود دعوة مساحة عمل (اختياري)" : "Workspace Invite Code (Optional)"}
              </span>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="text"
                  dir="ltr"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="MZN-XXXX-YYYY"
                  className="w-full h-11 ps-10 pe-3 rounded-xl bg-[var(--fill)] text-[14px] font-mono uppercase outline-none focus:ring-2 focus:ring-[var(--tint)]"
                />
              </div>
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowInviteField(true)}
              className="text-[13px] font-semibold text-[var(--tint)] flex items-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {isAr ? "لديك كود دعوة لمساحة عمل؟" : "Have a workspace invite code?"}
            </button>
          )}

          <PillButton type="submit" disabled={busy} className="w-full h-12 text-[15px]">
            <LogIn className="w-4 h-4" />
            {busy
              ? isAr
                ? "جارٍ المتابعة…"
                : "Working…"
              : mode === "signin"
                ? isAr
                  ? "دخول إلى مساحاتك"
                  : "Sign in to Workspaces"
                : isAr
                  ? "إنشاء الحساب والبدء"
                  : "Create Account & Start"}
          </PillButton>
        </form>

        <div className="relative flex items-center py-1">
          <div className="flex-1 border-t border-[var(--sep)]" />
          <span className="px-3 text-[12px] text-[var(--label-3)]">{isAr ? "أو" : "OR"}</span>
          <div className="flex-1 border-t border-[var(--sep)]" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full h-11 rounded-xl border border-[var(--sep)] bg-[var(--surface)] hover:bg-[var(--fill)] text-[14px] font-semibold flex items-center justify-center gap-2 transition"
        >
          <Sparkles className="w-4 h-4 text-[var(--tint)]" />
          {isAr ? "المتابعة بحساب Google" : "Continue with Google"}
        </button>

        <div className="rounded-2xl bg-[var(--fill)] p-3.5 text-[12px] text-[var(--label-2)] flex items-start gap-2.5 leading-relaxed">
          <Building2 className="w-4 h-4 text-[var(--tint)] shrink-0 mt-0.5" />
          <span>
            {isAr
              ? "بعد أول تسجيل دخول، يتم حفظ بيانات مساحتك محليًا لكل مستأجر مع إمكانية العمل أوفلاين والمزامنة التلقائية لاحقًا. الخطة الشهرية والسنوية بسعر رمزي وبدون تقييد للمميزات."
              : "After first sign-in, each tenant works offline-first with isolated local storage and automatic outbox sync. All features are unlocked across monthly & yearly plans."}
          </span>
        </div>
      </div>
    </div>
  );
}
