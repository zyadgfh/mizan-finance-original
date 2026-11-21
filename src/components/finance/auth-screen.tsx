import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Crown,
  Download,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  KeyRound,
  Lock,
  LogIn,
  Phone,
  Scale,
  Smartphone,
  Sparkles,
  Upload,
  User,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { APPLE_THEMES, updateUiPrefs, useUiPrefs } from "@/lib/finance/prefs";
import { copyTextSafe, isNativeMobileApp } from "@/lib/mobile-safe";
import {
  checkHasPlatformOwner,
  EmailNotVerifiedError,
  fetchPublicSignupConfig,
  registerNewSubscriberWithPayment,
  requestPasswordResetEmail,
  resendSignupVerification,
  setupInitialPlatformOwner,
  signInWithEmailPassword,
} from "@/lib/tenant/api";
import { PENDING_INVITE_KEY } from "@/lib/tenant/context";
import { compressTransferProofImage, normalizeSubscriberIdentity } from "@/lib/tenant/identity";
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  formatPlanLabel,
  type PlanCode,
  type PlatformBillingInfo,
  type SubscriptionPlan,
} from "@/lib/tenant/types";

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

  const [view, setView] = useState<"signin" | "signup" | "forgot" | "owner-setup">("signin");
  const [signupStep, setSignupStep] = useState<"account" | "payment">("account");

  // Sign-in state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  // Sign-up + Payment state
  const [signupName, setSignupName] = useState("");
  const [signupIdentifier, setSignupIdentifier] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>("monthly");
  const [payMethod, setPayMethod] = useState<"instapay" | "vodafone_cash">("instapay");
  const [senderHandle, setSenderHandle] = useState("");
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string>("");
  const [compressingProof, setCompressingProof] = useState(false);
  const uiPrefs = useUiPrefs();

  // Public plans & receiver info
  const [plans, setPlans] = useState<SubscriptionPlan[]>(DEFAULT_SUBSCRIPTION_PLANS);
  const [billingInfo, setBillingInfo] = useState<PlatformBillingInfo | null>(null);

  // Misc state
  const [ownerName, setOwnerName] = useState("زياد جمال");
  const [inviteCode, setInviteCode] = useState(
    initialInviteCode ??
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PENDING_INVITE_KEY) ?? "" : ""),
  );
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showInviteField, setShowInviteField] = useState(Boolean(initialInviteCode));
  const [needsOwnerBootstrap, setNeedsOwnerBootstrap] = useState(false);

  const isNativeCap = isNativeMobileApp();

  // Android hardware back-button support across multi-step signup & password recovery
  useEffect(() => {
    const win = window as Window & { __mizanBack?: () => boolean };
    const prev = win.__mizanBack;
    win.__mizanBack = () => {
      if (view === "signup" && signupStep === "payment") {
        setSignupStep("account");
        return true;
      }
      if (view !== "signin") {
        setView("signin");
        return true;
      }
      return typeof prev === "function" ? prev() : false;
    };
    return () => {
      win.__mizanBack = prev;
    };
  }, [view, signupStep]);

  useEffect(() => {
    let active = true;
    void checkHasPlatformOwner().then((exists) => {
      if (active) setNeedsOwnerBootstrap(!exists);
    });
    void fetchPublicSignupConfig()
      .then((cfg) => {
        if (!active) return;
        if (cfg.plans.length > 0) setPlans(cfg.plans);
        setBillingInfo(cfg.billingInfo);
        if (!cfg.billingInfo.instapayHandle && cfg.billingInfo.vodafoneCashNumber) {
          setPayMethod("vodafone_cash");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const currentPlanObj = plans.find((p) => p.code === selectedPlan) ?? plans[0] ?? DEFAULT_SUBSCRIPTION_PLANS[0];
  const baseMonthlyPrice = plans.find((p) => p.code === "monthly")?.priceEgp ?? 29;

  const copyReceiverValue = async (val: string, label: string) => {
    if (!val) return;
    const copied = await copyTextSafe(val);
    if (copied) {
      toast.success(isAr ? `تم نسخ ${label}` : `${label} copied`);
    } else {
      toast.info(val);
    }
  };

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error(
        isAr ? "أدخل البريد الإلكتروني أو رقم الهاتف وكلمة المرور" : "Enter email/phone and password",
      );
      return;
    }
    if (inviteCode.trim() && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_INVITE_KEY, inviteCode.trim().toUpperCase());
    }
    setBusy(true);
    setNeedsVerification(false);
    try {
      await signInWithEmailPassword(identifier, password);
      toast.success(isAr ? "تم تسجيل الدخول بنجاح" : "Signed in successfully");
      onSignedIn?.();
    } catch (err) {
      if (err instanceof EmailNotVerifiedError) {
        setNeedsVerification(true);
      }
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

  const resendVerification = async () => {
    setBusy(true);
    try {
      await resendSignupVerification(identifier);
      toast.success(
        isAr ? "تم إرسال رابط التأكيد، تحقق من بريدك الإلكتروني" : "Verification link sent — check your inbox",
      );
      setNeedsVerification(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر إرسال رابط التأكيد" : "Failed to resend");
    } finally {
      setBusy(false);
    }
  };

  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeSubscriberIdentity(signupIdentifier);
    if (!normalized) {
      toast.error(
        isAr
          ? "أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح (مثل 01012345678)"
          : "Enter a valid email address or phone number",
      );
      return;
    }
    if (signupPassword.length < 8) {
      toast.error(
        isAr
          ? "كلمة المرور يجب أن تتكون من 8 أحرف أو أرقام على الأقل"
          : "Password must be at least 8 characters",
      );
      return;
    }
    setSignupStep("payment");
  };

  const handleSelectProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressingProof(true);
    try {
      const compressed = await compressTransferProofImage(file);
      setProofDataUrl(compressed);
      setProofFileName(file.name);
      toast.success(isAr ? "تم إرفاق صورة التحويل بنجاح" : "Transfer screenshot attached");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "تعذّر قراءة الصورة" : "Failed to load image");
    } finally {
      setCompressingProof(false);
      e.target.value = "";
    }
  };

  const handleCompleteSignupAndPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderHandle.trim() || senderHandle.trim().length < 3) {
      toast.error(
        payMethod === "instapay"
          ? isAr
            ? "أدخل اليوزر نيم على إنستا باي أو الرقم الذي تم منه التحويل"
            : "Enter your InstaPay username or sender phone number"
          : isAr
            ? "أدخل الرقم الذي تم منه التحويل"
            : "Enter the phone number you transferred from",
      );
      return;
    }
    if (!proofDataUrl) {
      toast.error(
        isAr ? "يرجى رفع صورة إيصال التحويل قبل الضغط على تم الدفع" : "Please upload the transfer screenshot first",
      );
      return;
    }

    setBusy(true);
    try {
      const verification = await registerNewSubscriberWithPayment({
        identifier: signupIdentifier,
        password: signupPassword,
        displayName: signupName,
        planCode: selectedPlan,
        paymentMethod: payMethod,
        senderHandle,
        proofDataUrl,
      });
      toast.success(
        verification.verificationEmailSent
          ? isAr
            ? "تم إرسال طلب الاشتراك! سيتفعّل حسابك فور مراجعة إيصال التحويل أو تأكيد الرابط المرسل لبريدك."
            : "Registration submitted! Your account activates once payment is approved or email confirmed."
          : isAr
            ? "تم إرسال طلب الاشتراك وإيصال التحويل بنجاح! سيتفعّل دخولك فور مراجعة الإدارة للتحويل."
            : "Registration & transfer receipt submitted! Your login activates once approved.",
      );
      setIdentifier(signupIdentifier);
      setView("signin");
      setSignupStep("account");
      setNeedsVerification(true);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isAr
            ? "حدث خطأ أثناء إرسال طلب الاشتراك"
            : "Registration failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      toast.error(isAr ? "أدخل بريدك الإلكتروني أولاً" : "Enter your email address");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordResetEmail(identifier);
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
    if (password.length < 8) {
      toast.error(
        isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters",
      );
      return;
    }
    if (bootstrapSecret.trim().length < 32) {
      toast.error(
        isAr
          ? "أدخل رمز تهيئة المنصة (MIZAN_BOOTSTRAP_SECRET) المكوّن من 32 حرفاً على الأقل"
          : "Enter the platform bootstrap secret (32+ characters)",
      );
      return;
    }
    setBusy(true);
    try {
      await setupInitialPlatformOwner({
        email: DEFAULT_OWNER_EMAIL,
        password,
        displayName: ownerName,
        bootstrapSecret: bootstrapSecret.trim(),
      });
      setNeedsOwnerBootstrap(false);
      setBootstrapSecret("");
      setIdentifier(DEFAULT_OWNER_EMAIL);
      setView("signin");
      setNeedsVerification(true);
      toast.success(
        isAr
          ? "تم إنشاء حساب المالك. أكّد بريدك الإلكتروني ثم سجّل الدخول."
          : "Owner account created. Verify your email, then sign in.",
      );
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
    <div className="min-h-full w-full bg-[var(--surround)] flex flex-col items-center justify-start sm:justify-center p-4 pt-safe pb-safe sm:p-6">
      <div className="my-auto w-full max-w-md bg-[var(--surface)] rounded-[28px] border border-[var(--sep)] shadow-[0_24px_60px_rgba(0,0,0,0.08)] p-5 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--tint-soft)] flex items-center justify-center shrink-0">
              <Scale className="w-6 h-6 text-[var(--tint)]" strokeWidth={2.1} />
            </div>
            <div>
              <h1 className="text-[20px] sm:text-[22px] font-bold tracking-tight">
                {isAr ? "ميزان لإدارة أموالك" : "Mizan Finance"}
              </h1>
              <p className="text-[11px] sm:text-[12px] text-[var(--label-3)]">
                {isAr
                  ? "دفتر مالي ذكي يعمل أوفلاين ويزامن حسابك بأمان سحابياً"
                  : "Offline-first personal & business ledger with cloud sync"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateUiPrefs({ language: isAr ? "en" : "ar" })}
            className="h-9 px-3 rounded-full bg-[var(--fill)] text-[12px] font-semibold flex items-center gap-1.5 shrink-0"
            aria-label={isAr ? "Switch to English" : "التبديل للعربية"}
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            {isAr ? "EN" : "AR"}
          </button>
        </div>

        {/* Instant /appledesign1 Theme Bar */}
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--fill)] px-3 py-2">
          <span className="text-[11px] font-semibold text-[var(--label-2)]">
            {isAr ? "تصميم Apple:" : "Apple Theme:"}
          </span>
          <div className="flex items-center gap-1.5">
            {APPLE_THEMES.map((th) => {
              const active = uiPrefs.appleTheme === th.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => updateUiPrefs({ appleTheme: th.id })}
                  title={isAr ? th.nameAr : th.nameEn}
                  aria-label={isAr ? th.nameAr : th.nameEn}
                  className={`h-6 w-6 rounded-full transition ${
                    active ? "scale-110 ring-2 ring-[var(--label)] ring-offset-1 ring-offset-[var(--surface)]" : "opacity-75"
                  }`}
                  style={{ background: th.swatch }}
                />
              );
            })}
          </div>
        </div>

        {/* Main Mode Switcher: Sign In vs Register New Account */}
        {(view === "signin" || view === "signup") && (
          <div className="grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-[var(--fill)]">
            <button
              type="button"
              onClick={() => setView("signin")}
              className={`h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition ${
                view === "signin"
                  ? "bg-[var(--surface)] text-[var(--label)] shadow-sm"
                  : "text-[var(--label-3)]"
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>{isAr ? "تسجيل الدخول" : "Sign In"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setView("signup");
                setSignupStep("account");
              }}
              className={`h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition ${
                view === "signup"
                  ? "bg-[var(--tint)] text-white shadow-sm"
                  : "text-[var(--tint)] hover:bg-[var(--tint-soft)]"
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>{isAr ? "تسجيل حساب جديد" : "New Account"}</span>
            </button>
          </div>
        )}

        {/* One-time Owner Bootstrap Banner */}
        {needsOwnerBootstrap && view !== "owner-setup" && (
          <div className="p-3.5 rounded-2xl bg-[var(--tint-soft)] border border-[var(--tint)] space-y-2">
            <div className="flex items-center gap-2 font-bold text-[13px] text-[var(--tint)]">
              <Crown className="w-4 h-4" />
              {isAr ? "تهيئة حساب مالك المنصة لأول مرة" : "First-Time Platform Owner Setup"}
            </div>
            <button
              type="button"
              onClick={() => {
                setIdentifier(DEFAULT_OWNER_EMAIL);
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
          <form onSubmit={submitSignIn} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                {isAr ? "البريد الإلكتروني أو رقم الهاتف" : "Email or Phone Number"}
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="text"
                  dir="ltr"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={isAr ? "010xxxxxxxx أو name@mail.com" : "010xxxxxxxx or name@mail.com"}
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
                  className="text-[11px] font-semibold text-[var(--tint)] hover:underline"
                >
                  {isAr ? "نسيت كلمة المرور؟" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type={showPass ? "text" : "password"}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 ps-10 pe-10 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--label-3)]"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needsVerification && (
              <div className="p-3 rounded-2xl bg-[var(--tint-soft)] border border-[var(--tint)] space-y-2">
                <p className="text-[11px] font-semibold text-[var(--tint)] leading-relaxed">
                  {isAr
                    ? "حسابك وطلب اشتراكك قيد التفعيل الآن — سيتم فتح الدخول تلقائياً فور تأكيد إيصال التحويل من إدارة المنصة."
                    : "Your account is awaiting activation — sign-in unlocks automatically once your transfer receipt is approved."}
                </p>
                {normalizeSubscriberIdentity(identifier)?.kind === "email" && (
                  <button
                    type="button"
                    onClick={() => void resendVerification()}
                    disabled={busy}
                    className="h-9 px-3.5 rounded-xl bg-[var(--tint)] text-white text-[12px] font-semibold disabled:opacity-60"
                  >
                    {isAr ? "إعادة إرسال رابط التأكيد للبريد" : "Resend verification email"}
                  </button>
                )}
              </div>
            )}

            {/* Optional Invite Code */}
            <div>
              {!showInviteField ? (
                <button
                  type="button"
                  onClick={() => setShowInviteField(true)}
                  className="text-[12px] text-[var(--label-3)] hover:text-[var(--tint)] flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {isAr ? "لديك كود دعوة للانضمام لمساحة مشتركة؟" : "Have a workspace invite code?"}
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
                    placeholder="MZN-XXXX-XXXX"
                    className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[13px] font-mono uppercase outline-none focus:ring-2 ring-[var(--tint)]"
                  />
                </div>
              )}
            </div>

            <PillButton type="submit" disabled={busy} className="w-full h-11 text-[14px] justify-center">
              <LogIn className="w-4 h-4" />
              <span>{busy ? (isAr ? "جارٍ تسجيل الدخول…" : "Signing in…") : isAr ? "تسجيل الدخول" : "Sign In"}</span>
            </PillButton>

            <div className="pt-2 border-t border-[var(--sep)] text-center">
              <p className="text-[12px] text-[var(--label-3)] mb-2">
                {isAr ? "ليس لديك حساب بعد؟" : "Don't have an account yet?"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setView("signup");
                  setSignupStep("account");
                }}
                className="w-full h-11 rounded-2xl bg-[var(--tint-soft)] text-[var(--tint)] font-bold text-[13px] flex items-center justify-center gap-2 hover:opacity-90 transition"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isAr ? "تسجيل حساب جديد واختيار الباقة" : "Register New Account & Choose Plan"}</span>
              </button>
            </div>
          </form>
        )}

        {/* VIEW 2: NEW SUBSCRIBER REGISTRATION + PACKAGE + PAYMENT PROOF */}
        {view === "signup" && (
          <div className="space-y-4">
            {/* Stepper Progress */}
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <div
                className={`flex-1 py-1.5 px-2.5 rounded-xl text-center ${
                  signupStep === "account"
                    ? "bg-[var(--tint-soft)] text-[var(--tint)] border border-[var(--tint)]"
                    : "bg-[var(--green-soft)] text-[var(--green)]"
                }`}
              >
                {isAr ? "1. بيانات الحساب والباقة" : "1. Account & Plan"}
              </div>
              <div
                className={`flex-1 py-1.5 px-2.5 rounded-xl text-center ${
                  signupStep === "payment"
                    ? "bg-[var(--tint-soft)] text-[var(--tint)] border border-[var(--tint)]"
                    : "bg-[var(--fill)] text-[var(--label-3)]"
                }`}
              >
                {isAr ? "2. الدفع وصورة التحويل" : "2. Payment & Receipt"}
              </div>
            </div>

            {/* STEP 1: ACCOUNT CREDENTIALS + 4 AFFORDABLE PACKAGES */}
            {signupStep === "account" && (
              <form onSubmit={handleProceedToPayment} noValidate className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                    {isAr ? "الاسم (اختياري)" : "Your Name (optional)"}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                    <input
                      type="text"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      placeholder={isAr ? "مثال: أحمد محمد" : "e.g. Ahmed Mohamed"}
                      className="w-full h-10 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[13px] outline-none focus:ring-2 ring-[var(--tint)]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                    {isAr ? "البريد الإلكتروني أو رقم الهاتف *" : "Email or Phone Number *"}
                  </label>
                  <div className="relative">
                    <Smartphone className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                    <input
                      type="text"
                      dir="ltr"
                      autoComplete="username"
                      value={signupIdentifier}
                      onChange={(e) => setSignupIdentifier(e.target.value)}
                      placeholder={isAr ? "010xxxxxxxx أو name@mail.com" : "010xxxxxxxx or name@mail.com"}
                      className="w-full h-11 ps-10 pe-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                    {isAr ? "كلمة المرور (8 أحرف أو أرقام على الأقل) *" : "Password (8+ characters) *"}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[var(--label-3)] absolute top-1/2 -translate-y-1/2 start-3.5" />
                    <input
                      type={showSignupPass ? "text" : "password"}
                      dir="ltr"
                      autoComplete="new-password"
                      minLength={8}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-11 ps-10 pe-10 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPass((v) => !v)}
                      className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--label-3)]"
                      tabIndex={-1}
                    >
                      {showSignupPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 4 Affordable Subscription Packages */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-bold text-[var(--label)]">
                      {isAr ? "اختر باقة الاشتراك المناسبة لك:" : "Choose Your Subscription Package:"}
                    </label>
                    <span className="text-[10px] text-[var(--green)] font-semibold bg-[var(--green-soft)] px-2 py-0.5 rounded-full">
                      {isAr ? "أسعار ميسّرة للجميع" : "Pocket-friendly"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {plans.map((p) => {
                      const active = selectedPlan === p.code;
                      const monthsCount = Math.max(1, Math.round(p.durationDays / 30));
                      const perMonth = Math.round((p.priceEgp / monthsCount) * 10) / 10;
                      const fullPrice = baseMonthlyPrice * monthsCount;
                      const savePct =
                        monthsCount > 1 && fullPrice > p.priceEgp
                          ? Math.round(((fullPrice - p.priceEgp) / fullPrice) * 100)
                          : 0;

                      return (
                        <button
                          key={p.code}
                          type="button"
                          onClick={() => setSelectedPlan(p.code)}
                          className={`relative p-3 rounded-2xl border text-start transition space-y-1 ${
                            active
                              ? "border-[var(--tint)] bg-[var(--tint-soft)] ring-1 ring-[var(--tint)]"
                              : "border-[var(--sep)] bg-[var(--fill)] hover:border-[var(--label-3)]"
                          }`}
                        >
                          {p.code === "yearly" && (
                            <span className="absolute -top-2 end-2 px-2 py-0.5 rounded-full bg-[var(--tint)] text-white text-[9px] font-bold flex items-center gap-0.5">
                              <Sparkles className="w-2.5 h-2.5" />
                              {isAr ? "الأوفر" : "Best Value"}
                            </span>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[13px] text-[var(--label)]">
                              {formatPlanLabel(p.code, lang)}
                            </span>
                            {active && <CheckCircle2 className="w-4 h-4 text-[var(--tint)] shrink-0" />}
                          </div>
                          <div className="text-[20px] font-extrabold text-[var(--label)] leading-tight">
                            {p.priceEgp}{" "}
                            <span className="text-[11px] font-semibold text-[var(--label-3)]">
                              {isAr ? "ج.م" : "EGP"}
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--label-3)] flex items-center justify-between">
                            <span>
                              {monthsCount === 1
                                ? isAr
                                  ? "أقل من جنيه يومياً"
                                  : "< 1 EGP / day"
                                : isAr
                                  ? `${perMonth} ج.م / شهر`
                                  : `${perMonth} EGP/mo`}
                            </span>
                            {savePct > 0 && (
                              <span className="text-[var(--green)] font-bold">
                                {isAr ? `وفّر ${savePct}%` : `-${savePct}%`}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <PillButton type="submit" className="w-full h-11 text-[14px] justify-center">
                  <CreditCard className="w-4 h-4" />
                  <span>
                    {isAr
                      ? `الدفع (${formatPlanLabel(currentPlanObj.code, "ar")} — ${currentPlanObj.priceEgp} ج.م)`
                      : `Proceed to Payment (${currentPlanObj.priceEgp} EGP)`}
                  </span>
                  {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </PillButton>
              </form>
            )}

            {/* STEP 2: PAYMENT DETAILS + SENDER NUMBER/IPA + SCREENSHOT UPLOAD */}
            {signupStep === "payment" && (
              <form onSubmit={handleCompleteSignupAndPay} className="space-y-3.5">
                {/* Selected Package Banner */}
                <div className="p-3 rounded-2xl bg-[var(--tint-soft)] border border-[var(--tint)] flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-[var(--label-2)]">
                      {isAr ? "الباقة المختارة والمبلغ المطلوب تحويله:" : "Selected Package & Amount Due:"}
                    </div>
                    <div className="font-extrabold text-[16px] text-[var(--tint)]">
                      {formatPlanLabel(currentPlanObj.code, lang)} — {currentPlanObj.priceEgp}{" "}
                      {isAr ? "ج.م" : "EGP"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSignupStep("account")}
                    className="h-8 px-2.5 rounded-xl bg-[var(--surface)] text-[11px] font-bold text-[var(--label)] border border-[var(--sep)]"
                  >
                    {isAr ? "تعديل" : "Change"}
                  </button>
                </div>

                {/* Payment Method Tabs: InstaPay vs Vodafone Cash */}
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-[var(--label-2)] block">
                    {isAr ? "اختر وسيلة التحويل:" : "Select Transfer Method:"}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayMethod("instapay")}
                      className={`h-10 px-3 rounded-xl text-[12px] font-bold border transition ${
                        payMethod === "instapay"
                          ? "border-[var(--tint)] bg-[var(--tint-soft)] text-[var(--tint)]"
                          : "border-[var(--sep)] bg-[var(--fill)] text-[var(--label-2)]"
                      }`}
                    >
                      {isAr ? "إنستا باي (InstaPay)" : "InstaPay"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMethod("vodafone_cash")}
                      className={`h-10 px-3 rounded-xl text-[12px] font-bold border transition ${
                        payMethod === "vodafone_cash"
                          ? "border-[var(--tint)] bg-[var(--tint-soft)] text-[var(--tint)]"
                          : "border-[var(--sep)] bg-[var(--fill)] text-[var(--label-2)]"
                      }`}
                    >
                      {isAr ? "فودافون كاش / محفظة" : "Vodafone Cash"}
                    </button>
                  </div>
                </div>

                {/* Owner Receiver Account Box */}
                <div className="p-3.5 rounded-2xl bg-[var(--fill)] border border-[var(--sep)] space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--label-2)]">
                    {payMethod === "instapay"
                      ? isAr
                        ? `حوّل مبلغ ${currentPlanObj.priceEgp} ج.م عبر إنستا باي إلى الحساب التالي:`
                        : `Transfer ${currentPlanObj.priceEgp} EGP via InstaPay to:`
                      : isAr
                        ? `حوّل مبلغ ${currentPlanObj.priceEgp} ج.م عبر فودافون كاش / المحفظة إلى الرقم التالي:`
                        : `Transfer ${currentPlanObj.priceEgp} EGP via Vodafone Cash to:`}
                  </div>

                  {payMethod === "instapay" && billingInfo?.instapayHandle && (
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--sep)]">
                      <span className="font-mono font-bold text-[14px]" dir="ltr">
                        {billingInfo.instapayHandle}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyReceiverValue(billingInfo.instapayHandle, "عنوان إنستا باي")}
                        className="h-8 px-2.5 rounded-lg bg-[var(--tint-soft)] text-[var(--tint)] text-[11px] font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {isAr ? "نسخ" : "Copy"}
                      </button>
                    </div>
                  )}

                  {payMethod === "vodafone_cash" && billingInfo?.vodafoneCashNumber && (
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--sep)]">
                      <span className="font-mono font-bold text-[15px]" dir="ltr">
                        {billingInfo.vodafoneCashNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyReceiverValue(billingInfo.vodafoneCashNumber, "رقم فودافون كاش")}
                        className="h-8 px-2.5 rounded-lg bg-[var(--tint-soft)] text-[var(--tint)] text-[11px] font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {isAr ? "نسخ" : "Copy"}
                      </button>
                    </div>
                  )}

                  {/* Fallback if only one receiver handle is set */}
                  {payMethod === "instapay" && !billingInfo?.instapayHandle && billingInfo?.vodafoneCashNumber && (
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--sep)]">
                      <span className="font-mono font-bold text-[14px]" dir="ltr">
                        {billingInfo.vodafoneCashNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyReceiverValue(billingInfo.vodafoneCashNumber, "الرقم")}
                        className="h-8 px-2.5 rounded-lg bg-[var(--tint-soft)] text-[var(--tint)] text-[11px] font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {isAr ? "نسخ" : "Copy"}
                      </button>
                    </div>
                  )}

                  {billingInfo?.instructionsAr && (
                    <p className="text-[11px] text-[var(--label-3)] whitespace-pre-line leading-relaxed">
                      {isAr ? billingInfo.instructionsAr : billingInfo.instructionsEn}
                    </p>
                  )}
                </div>

                {/* Sender Phone Number OR InstaPay Username */}
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-[var(--label)] block">
                    {payMethod === "instapay"
                      ? isAr
                        ? "اليوزر نيم على إنستا باي (IPA) أو الرقم الذي تم منه التحويل *"
                        : "Your InstaPay Username (IPA) or Sender Phone *"
                      : isAr
                        ? "الرقم الذي تم منه التحويل *"
                        : "Sender Phone Number *"}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={senderHandle}
                    onChange={(e) => setSenderHandle(e.target.value)}
                    placeholder={
                      payMethod === "instapay"
                        ? "username@instapay / 010xxxxxxxx"
                        : "010xxxxxxxx"
                    }
                    className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] font-mono outline-none focus:ring-2 ring-[var(--tint)]"
                    required
                  />
                </div>

                {/* Upload Transfer Screenshot */}
                <div className="space-y-1.5">
                  <span className="text-[12px] font-bold text-[var(--label)] block">
                    {isAr ? "صورة إيصال التحويل (لقطة شاشة التحويل) *" : "Transfer Screenshot / Receipt *"}
                  </span>

                  {!proofDataUrl ? (
                    <label
                      className={`relative w-full py-5 px-4 rounded-2xl border-2 border-dashed border-[var(--sep)] hover:border-[var(--tint)] bg-[var(--fill)] flex flex-col items-center justify-center gap-1.5 transition cursor-pointer active:opacity-85 ${
                        compressingProof ? "pointer-events-none opacity-60" : ""
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                        disabled={compressingProof}
                        onChange={(e) => void handleSelectProofFile(e)}
                        className="sr-only"
                      />
                      <ImagePlus className="w-7 h-7 text-[var(--tint)]" />
                      <span className="text-[13px] font-bold text-[var(--label)]">
                        {compressingProof
                          ? isAr
                            ? "جارٍ تجهيز صورة التحويل…"
                            : "Processing screenshot…"
                          : isAr
                            ? "اضغط لرفع صورة التحويل"
                            : "Tap to Upload Transfer Screenshot"}
                      </span>
                      <span className="text-[11px] text-[var(--label-3)] text-center">
                        {isAr ? "صورة واضحة لإشعار إنستا باي أو فودافون كاش" : "Clear screenshot of the transfer"}
                      </span>
                    </label>
                  ) : (
                    <div className="p-2.5 rounded-2xl bg-[var(--fill)] border border-[var(--tint)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-bold text-[var(--green)] flex items-center gap-1">
                          <Check className="w-4 h-4" />
                          {isAr ? "تم إرفاق صورة التحويل" : "Screenshot attached"}
                        </span>
                        <label className="relative h-8 px-3 rounded-lg bg-[var(--surface)] text-[11px] font-semibold flex items-center gap-1 cursor-pointer active:opacity-80">
                          <input
                            type="file"
                            accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                            disabled={compressingProof}
                            onChange={(e) => void handleSelectProofFile(e)}
                            className="sr-only"
                          />
                          <Upload className="w-3 h-3" />
                          <span>{isAr ? "تغيير الصورة" : "Replace"}</span>
                        </label>
                      </div>
                      <img
                        src={proofDataUrl}
                        alt={proofFileName || "Transfer proof"}
                        className="w-full max-h-44 object-contain rounded-xl bg-black/5"
                      />
                    </div>
                  )}
                </div>

                <PillButton
                  type="submit"
                  disabled={busy || compressingProof}
                  className="w-full h-12 text-[14px] justify-center"
                >
                  <CheckCircle2 className="w-4.5 h-4.5" />
                  <span>
                    {busy
                      ? isAr
                        ? "جارٍ إرسال الطلب ورفع الإيصال…"
                        : "Submitting request…"
                      : isAr
                        ? "تم الدفع — إرسال طلب التفعيل للمالك"
                        : "Payment Sent — Submit for Activation"}
                  </span>
                </PillButton>
              </form>
            )}
          </div>
        )}

        {/* VIEW 3: FORGOT PASSWORD */}
        {view === "forgot" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setView("signin")}
              className="text-[12px] font-semibold text-[var(--tint)] flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {isAr ? "العودة لتسجيل الدخول" : "Back to Sign In"}
            </button>

            <div className="space-y-1">
              <h2 className="text-[17px] font-bold">
                {isAr ? "استعادة كلمة المرور" : "Reset Password"}
              </h2>
              <p className="text-[12px] text-[var(--label-3)]">
                {isAr
                  ? "أدخل بريدك الإلكتروني المسجّل لإرسال رابط الاستعادة، أو تواصل مع مالك المنصة إذا كنت مسجلاً برقم الهاتف."
                  : "Enter your registered email for a reset link, or contact the owner for phone accounts."}
              </p>
            </div>

            {resetSent ? (
              <div className="p-4 rounded-2xl bg-[var(--green-soft)] text-[var(--green)] text-[13px] font-medium">
                {isAr
                  ? "تم إرسال الرابط بنجاح! تفقد بريدك الوارد."
                  : "Reset link sent! Check your inbox."}
              </div>
            ) : (
              <form onSubmit={submitForgotPassword} noValidate className="space-y-3.5">
                <input
                  type="email"
                  dir="ltr"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full h-11 px-3.5 rounded-xl bg-[var(--fill)] text-[14px] outline-none focus:ring-2 ring-[var(--tint)]"
                  required
                />
                <PillButton type="submit" disabled={busy} className="w-full h-11 text-[14px] justify-center">
                  {busy
                    ? isAr
                      ? "جارٍ الإرسال…"
                      : "Sending…"
                    : isAr
                      ? "إرسال رابط الاستعادة"
                      : "Send Reset Link"}
                </PillButton>
              </form>
            )}
          </div>
        )}

        {/* VIEW 4: ONE-TIME INITIAL PLATFORM OWNER BOOTSTRAP */}
        {view === "owner-setup" && needsOwnerBootstrap && (
          <form onSubmit={submitOwnerSetup} className="space-y-3.5">
            <button
              type="button"
              onClick={() => setView("signin")}
              className="text-[12px] font-semibold text-[var(--tint)] flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {isAr ? "رجوع" : "Back"}
            </button>
            <div className="space-y-1">
              <h2 className="text-[17px] font-bold flex items-center gap-2">
                <Crown className="w-4 h-4 text-[var(--tint)]" />
                {isAr ? "تهيئة حساب مالك المنصة" : "Initialize Owner Account"}
              </h2>
            </div>
            <input
              type="email"
              dir="ltr"
              value={DEFAULT_OWNER_EMAIL}
              readOnly
              className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[13px] opacity-75"
            />
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder={isAr ? "الاسم المعروض" : "Display Name"}
              className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[14px]"
              required
            />
            <input
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isAr ? "اختر كلمة مرور قوية (8+ أحرف)" : "Choose strong password (8+ chars)"}
              className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[14px]"
              required
            />
            <div className="space-y-1">
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                value={bootstrapSecret}
                onChange={(e) => setBootstrapSecret(e.target.value)}
                placeholder={
                  isAr ? "رمز تهيئة المنصة (MIZAN_BOOTSTRAP_SECRET)" : "Platform bootstrap secret"
                }
                className="w-full h-10 px-3.5 rounded-xl bg-[var(--fill)] text-[13px]"
                required
              />
              <p className="text-[10px] text-[var(--label-3)] leading-relaxed">
                {isAr
                  ? "رمز سري أحادي الاستخدام محفوظ في أسرار المشروع، مطلوب لمنع أي طرف آخر من حجز حساب المالك."
                  : "A single-use secret stored in the project secrets; it prevents anyone else from claiming the owner account."}
              </p>
            </div>
            <p className="text-[10px] text-[var(--label-3)] leading-relaxed">
              {isAr
                ? "سيتم إرسال رابط تأكيد إلى البريد أعلاه، ويجب تأكيده قبل تسجيل الدخول."
                : "A confirmation link is emailed to the address above and must be confirmed before signing in."}
            </p>
            <PillButton type="submit" disabled={busy} className="w-full h-11 text-[14px] justify-center">
              {busy
                ? isAr
                  ? "جارٍ التهيئة…"
                  : "Initializing…"
                : isAr
                  ? "تأكيد وتفعيل حساب المالك"
                  : "Confirm Owner Setup"}
            </PillButton>
          </form>
        )}

        {/* Signed Release APK Direct Download Card (Web Only) */}
        {!isNativeCap && (
          <div className="pt-3 border-t border-[var(--sep)]">
            <a
              href={RELEASE_APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--fill)] hover:bg-[var(--tint-soft)] transition"
            >
              <div className="flex items-center gap-2.5">
                <Download className="w-4 h-4 text-[var(--tint)] shrink-0" />
                <div className="text-start">
                  <div className="text-[12px] font-bold text-[var(--label)]">
                    {isAr ? "تثبيت تطبيق ميزان للأندرويد (APK)" : "Download Mizan Android App (APK)"}
                  </div>
                  <div className="text-[10px] text-[var(--label-3)]">
                    {isAr
                      ? "نسخة Release موقّعة رسمياً وتدعم العمل بدون إنترنت"
                      : "Signed Release APK · Offline-ready"}
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-[var(--surface)] text-[11px] font-semibold text-[var(--tint)] shrink-0">
                APK
              </span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
