import {
  ArrowLeft,
  Crown,
  Download,
  Globe,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { updateUiPrefs } from "@/lib/finance/prefs";
import {
  checkHasPlatformOwner,
  requestPasswordResetEmail,
  setupInitialPlatformOwner,
  signInWithEmailPassword,
} from "@/lib/tenant/api";
import { PENDING_INVITE_KEY } from "@/lib/tenant/context";

export const RELEASE_APK_DOWNLOAD_URL =
  "https://github.com/zyadgfh/mizan-finance-original/releases/latest/download/mizan-finance-release.apk";

const DEFAULT_OWNER_EMAIL = "zyadgamal796@gmail.com";

export function AuthScreen({
  initialInviteCode,
  onSignedIn,
}: {
  initialInviteCode?: string;
  onSignedIn?: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [view, setView] = useState<"signin" | "forgot" | "owner-setup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerName, setOwnerName] = useState("زياد جمال");
  const [inviteCode, setInviteCode] = useState(
    initialInviteCode ??
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PENDING_INVITE_KEY) ?? "" : ""),
  );
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showInviteField, setShowInviteField] = useState(Boolean(initialInviteCode));
  const [needsOwnerBootstrap, setNeedsOwnerBootstrap] = useState(false);

  const isNativeCap =
    typeof window !== "undefined" &&
    (window.location.protocol.startsWith("capacitor") ||
      Boolean((window as unknown as { MizanNative?: unknown }).MizanNative));

  useEffect(() => {
    let active = true;
    void checkHasPlatformOwner().then((exists) => {
      if (active) setNeedsOwnerBootstrap(!exists);
    });
    return () => {
      active = false;
    };
  }, []);

  const submitSignIn = async (e: React.FormEvent) => {
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
      await signInWithEmailPassword(email, password);
      toast.success(isAr ? "تم تسجيل الدخول بنجاح" : "Signed in successfully");
      onSignedIn?.();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isAr
            ? "بيانات الدخول غير صحيحة"
            : "Invalid credentials",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error(isAr ? "أدخل بريدك الإلكتروني أولاً" : "Enter your email address");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordResetEmail(email);
      setResetSent(true);
      toast.success(
        isAr
          ? "تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني"
          : "Password reset link sent to your email",
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذّر إرسال رابط الاستعادة"
            : "Failed to send reset link",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitOwnerSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(
        isAr ? "كلمة المرور يجب أن تكون 6 أحرف على الأقل" : "Password must be at least 6 characters",
      );
      return;
    }
    setBusy(true);
    try {
      await setupInitialPlatformOwner({
        email: DEFAULT_OWNER_EMAIL,
        password,
        displayName: ownerName,
      });
      setNeedsOwnerBootstrap(false);
      toast.success(
        isAr
          ? "تم تفعيل حساب مالك المنصة وتسجيل الدخول بنجاح"
          : "Platform owner account initialized",
      );
      onSignedIn?.();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isAr
            ? "تعذّر تهيئة حساب المالك"
            : "Owner setup failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[var(--surround)] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[var(--surface)] rounded-[28px] border border-[var(--sep)] shadow-[0_24px_60px_rgba(0,0,0,0.08)] p-6 sm:p-8 space-y-5">
        {/* Header */}
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

        {/* Owner-Only Policy Notice */}
        <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-[var(--fill)] border border-[var(--sep)]">
          <ShieldCheck className="w-4 h-4 text-[var(--tint)] shrink-0 mt-0.5" />
          <p className="text-[12px] text-[var(--label-2)] leading-relaxed">
            {isAr
              ? "الوصول خاص ومغلق: مالك المنصة فقط هو من ينشئ الحسابات ويفعّل المساحات. سجّل دخولك بالبيانات المُسلّمة لك."
              : "Private access: accounts are provisioned exclusively by the platform owner. Sign in with your assigned credentials."}
          </p>
        </div>

        {/* One-time Owner Bootstrap Banner (Strictly disappears forever once owner initializes account) */}
        {needsOwnerBootstrap && view !== "owner-setup" && (
          <div className="p-3.5 rounded-2xl bg-[var(--tint-soft)] border border-[var(--tint)] space-y-2">
            <div className="flex items-center gap-2 font-bold text-[13px] text-[var(--tint)]">
              <Crown className="w-4 h-4" />
              {isAr ? "تهيئة حساب مالك المنصة لأول مرة" : "First-Time Platform Owner Setup"}
            </div>
            <p className="text-[12px] text-[var(--label-2)]">
              {isAr
                ? "لم يتم إعداد حساب المالك بعد. اضغط هنا لتعيين كلمة مرور حساب المالك الرئيسي لمرة واحدة."
                : "Initialize the primary owner account once to unlock the Super-Admin console."}
            </p>
            <button
              type="button"
              onClick={() => {
                setEmail(DEFAULT_OWNER_EMAIL);
                setView("owner-setup");
              }}
              className="h-9 px-3.5 rounded-xl bg-[var(--tint)] text-white text-[12px] font-semibold"
            >
              {isAr ? "إعداد حساب المالك الآن" : "Initialize Owner Account"}
            </button>
          </div>
        )}

        {/* VIEW 1: SIGN IN */}
        {view === "signin" && (
          <form onSubmit={submitSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                {isAr ? "البريد الإلكتروني" : "Email"}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full h-11 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-semibold text-[var(--label-2)]">
                  {isAr ? "كلمة المرور" : "Password"}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetSent(false);
                    setView("forgot");
                  }}
                  className="text-[12px] font-medium text-[var(--tint)] hover:underline"
                >
                  {isAr ? "نسيت كلمة المرور؟" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full h-11 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                  required
                />
              </div>
            </div>

            {/* Optional Workspace Invite Code */}
            <div className="pt-0.5">
              {!showInviteField ? (
                <button
                  type="button"
                  onClick={() => setShowInviteField(true)}
                  className="text-[12px] font-medium text-[var(--tint)] flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {isAr ? "لديك كود دعوة لمساحة مشتركة؟" : "Have a workspace invite code?"}
                </button>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                    {isAr ? "كود الدعوة (اختياري)" : "Invite Code (optional)"}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="MZN-XXXX-YYYY"
                    className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] font-mono tracking-wider uppercase outline-none focus:ring-2 ring-[var(--tint)]"
                  />
                </div>
              )}
            </div>

            <PillButton type="submit" disabled={busy} className="w-full h-11 text-[15px] justify-center">
              <LogIn className="w-4 h-4" />
              <span>
                {busy
                  ? isAr
                    ? "جارٍ تسجيل الدخول..."
                    : "Signing in..."
                  : isAr
                    ? "تسجيل الدخول"
                    : "Sign In"}
              </span>
            </PillButton>
          </form>
        )}

        {/* VIEW 2: FORGOT PASSWORD */}
        {view === "forgot" && (
          <form onSubmit={submitForgotPassword} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[16px]">
                {isAr ? "استعادة كلمة المرور" : "Reset Password"}
              </h2>
              <button
                type="button"
                onClick={() => setView("signin")}
                className="text-[12px] font-semibold text-[var(--tint)] flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {isAr ? "عودة للدخول" : "Back"}
              </button>
            </div>

            {resetSent ? (
              <div className="p-4 rounded-2xl bg-[var(--green-soft)] text-[var(--green)] text-[13px] space-y-2">
                <p className="font-semibold">
                  {isAr
                    ? "تم إرسال رابط إعادة التعيين بنجاح!"
                    : "Password recovery link sent!"}
                </p>
                <p className="text-[12px] text-[var(--label-2)]">
                  {isAr
                    ? "افتح الرسالة في بريدك الإلكتروني واضغط على الرابط لتعيين كلمة مرور جديدة."
                    : "Check your inbox and follow the link to choose a new password."}
                </p>
              </div>
            ) : (
              <>
                <p className="text-[12px] text-[var(--label-3)]">
                  {isAr
                    ? "أدخل بريدك الإلكتروني المسجّل لإرسال رابط إعادة تعيين كلمة المرور."
                    : "Enter your registered email address to receive a password reset link."}
                </p>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                  <input
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full h-11 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                    required
                  />
                </div>
                <PillButton type="submit" disabled={busy} className="w-full h-11 text-[14px] justify-center">
                  {busy
                    ? isAr
                      ? "جارٍ الإرسال..."
                      : "Sending..."
                    : isAr
                      ? "إرسال رابط استعادة كلمة المرور"
                      : "Send Recovery Link"}
                </PillButton>
              </>
            )}
          </form>
        )}

        {/* VIEW 3: ONE-TIME INITIAL OWNER SETUP */}
        {view === "owner-setup" && needsOwnerBootstrap && (
          <form onSubmit={submitOwnerSetup} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[16px] flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-[var(--tint)]" />
                {isAr ? "تهيئة حساب مالك المنصة" : "Owner Account Setup"}
              </h2>
              <button
                type="button"
                onClick={() => setView("signin")}
                className="text-[12px] font-semibold text-[var(--tint)]"
              >
                {isAr ? "عودة" : "Back"}
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                {isAr ? "بريد المالك المعتمد" : "Authorized Owner Email"}
              </label>
              <input
                type="email"
                dir="ltr"
                value={DEFAULT_OWNER_EMAIL}
                readOnly
                className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[13px] text-[var(--label-2)] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                {isAr ? "اسم العرض" : "Display Name"}
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                {isAr ? "اختر كلمة مرور قوية للمالك" : "Choose Owner Password"}
              </label>
              <input
                type="password"
                dir="ltr"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                required
              />
            </div>

            <PillButton type="submit" disabled={busy} className="w-full h-11 text-[14px] justify-center">
              <Crown className="w-4 h-4" />
              <span>
                {busy
                  ? isAr
                    ? "جارٍ التفعيل..."
                    : "Initializing..."
                  : isAr
                    ? "تفعيل حساب المالك والدخول"
                    : "Activate Owner & Sign In"}
              </span>
            </PillButton>
          </form>
        )}

        {/* Direct Android APK Release Download Link on Web */}
        {!isNativeCap && (
          <div className="pt-3 border-t border-[var(--sep)] flex items-center justify-between gap-2">
            <span className="text-[12px] text-[var(--label-3)]">
              {isAr ? "نسخة أندرويد الرسمية (APK)" : "Official Android App (APK)"}
            </span>
            <a
              href={RELEASE_APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-xl bg-[var(--fill)] text-[12px] font-semibold text-[var(--tint)] inline-flex items-center gap-1.5 hover:opacity-90"
            >
              <Download className="w-3.5 h-3.5" />
              {isAr ? "تحميل APK" : "Download APK"}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
