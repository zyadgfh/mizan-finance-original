import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  ImagePlus,
  Lock,
  LogOut,
  RefreshCw,
  Scale,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { updateUiPrefs } from "@/lib/finance/prefs";
import {
  fetchPlatformBillingInfo,
  getPaymentProofSignedUrl,
  listPaymentRequests,
  submitRenewalPaymentWithProof,
} from "@/lib/tenant/api";
import { useTenant } from "@/lib/tenant/context";
import { compressTransferProofImage } from "@/lib/tenant/identity";
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  formatPlanLabel,
  type PaymentRequestItem,
  type PlanCode,
  type PlatformBillingInfo,
  type SubscriptionBlockReason,
} from "@/lib/tenant/types";

export function SubscriptionGateScreen({ reason }: { reason: SubscriptionBlockReason }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user, activeTenant, plans, refreshWorkspaces, signOut } = useTenant();

  const availablePlans = plans.length > 0 ? plans : DEFAULT_SUBSCRIPTION_PLANS;

  const [requests, setRequests] = useState<PaymentRequestItem[]>([]);
  const [billingInfo, setBillingInfo] = useState<PlatformBillingInfo | null>(null);
  const [latestProofUrl, setLatestProofUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Renewal / resubmission form state
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>(activeTenant?.planCode ?? "monthly");
  const [payMethod, setPayMethod] = useState<"instapay" | "vodafone_cash">("instapay");
  const [senderHandle, setSenderHandle] = useState("");
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadGateInfo = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    try {
      const [reqs, bInfo] = await Promise.all([
        listPaymentRequests(activeTenant.id).catch(() => []),
        fetchPlatformBillingInfo().catch(() => null),
      ]);
      setRequests(reqs);
      if (bInfo) {
        setBillingInfo(bInfo);
        if (!bInfo.instapayHandle && bInfo.vodafoneCashNumber) {
          setPayMethod("vodafone_cash");
        }
      }
      const newestWithProof = reqs.find((r) => r.proofPath);
      if (newestWithProof?.proofPath) {
        const url = await getPaymentProofSignedUrl(newestWithProof.proofPath).catch(() => null);
        setLatestProofUrl(url);
      } else {
        setLatestProofUrl(null);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTenant]);

  useEffect(() => {
    void loadGateInfo();
  }, [loadGateInfo]);

  // Auto-poll every 20s while waiting for owner approval so account activates automatically
  const hasPendingRequest = requests.some((r) => r.status === "pending");
  useEffect(() => {
    if (!hasPendingRequest && reason !== "pending_approval") return;
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      void refreshWorkspaces();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [hasPendingRequest, reason, refreshWorkspaces]);

  const handleManualCheck = async () => {
    setCheckingStatus(true);
    try {
      await refreshWorkspaces();
      await loadGateInfo();
      toast.info(isAr ? "تم تحديث حالة الاشتراك" : "Subscription status refreshed");
    } finally {
      setCheckingStatus(false);
    }
  };

  const copyText = async (val: string, label: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      toast.success(isAr ? `تم نسخ ${label}` : `${label} copied`);
    } catch {
      toast.info(val);
    }
  };

  const handleSelectProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const dataUrl = await compressTransferProofImage(file);
      setProofDataUrl(dataUrl);
      toast.success(isAr ? "تم إرفاق صورة التحويل" : "Screenshot attached");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  };

  const handleSubmitRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant) return;
    if (!senderHandle.trim() || senderHandle.trim().length < 3) {
      toast.error(
        payMethod === "instapay"
          ? isAr
            ? "أدخل اليوزر نيم على إنستا باي أو الرقم المحوّل منه"
            : "Enter your InstaPay username or sender phone"
          : isAr
            ? "أدخل الرقم الذي تم منه التحويل"
            : "Enter sender phone number",
      );
      return;
    }
    if (!proofDataUrl) {
      toast.error(isAr ? "يرجى رفع صورة إيصال التحويل أولاً" : "Please upload transfer screenshot");
      return;
    }

    setSubmitting(true);
    try {
      await submitRenewalPaymentWithProof({
        tenantId: activeTenant.id,
        planCode: selectedPlan,
        paymentMethod: payMethod,
        senderHandle,
        proofDataUrl,
      });
      setSenderHandle("");
      setProofDataUrl(null);
      await loadGateInfo();
      toast.success(
        isAr
          ? "تم إرسال طلب التفعيل وصورة التحويل بنجاح! سيراجعه المالك قريباً."
          : "Payment proof submitted! Awaiting owner review.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const latestRequest = requests[0] ?? null;
  const currentPlanObj =
    availablePlans.find((p) => p.code === selectedPlan) ?? availablePlans[0] ?? DEFAULT_SUBSCRIPTION_PLANS[0];

  return (
    <div className="min-h-dvh bg-[var(--surround)] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[var(--surface)] rounded-[28px] border border-[var(--sep)] shadow-[0_24px_60px_rgba(0,0,0,0.08)] p-5 sm:p-7 space-y-5">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[var(--tint-soft)] flex items-center justify-center">
              <Scale className="w-5 h-5 text-[var(--tint)]" />
            </div>
            <div>
              <div className="font-bold text-[15px]">{user?.displayName || (isAr ? "حساب المشترك" : "Account")}</div>
              <div className="text-[11px] text-[var(--label-3)]" dir="ltr">
                {user?.email}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => updateUiPrefs({ language: isAr ? "en" : "ar" })}
              className="h-8 px-2.5 rounded-full bg-[var(--fill)] text-[11px] font-semibold flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              {isAr ? "EN" : "AR"}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="h-8 px-2.5 rounded-full bg-[var(--red-soft)] text-[var(--red)] text-[11px] font-semibold flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              {isAr ? "خروج" : "Sign Out"}
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {reason === "pending_approval" && (
          <div className="p-4 rounded-2xl bg-[var(--tint-soft)] border border-[var(--tint)] space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[15px] text-[var(--tint)]">
              <Clock className="w-5 h-5 shrink-0" />
              <span>
                {isAr ? "طلب اشتراكك قيد مراجعة وتأكيد المالك" : "Subscription Awaiting Owner Approval"}
              </span>
            </div>
            <p className="text-[12px] text-[var(--label-2)] leading-relaxed">
              {isAr
                ? "تم تسجيل حسابك واستلام بيانات التحويل. يقوم مالك الموقع بمراجعة إيصال الدفع وتفعيل حسابك فوراً، وسيفتح التطبيق تلقائياً بمجرد التفعيل."
                : "Your account and transfer receipt have been received. Once the owner approves the transfer, your account unlocks automatically."}
            </p>
          </div>
        )}

        {reason === "expired" && (
          <div className="p-4 rounded-2xl bg-[var(--red-soft)] border border-[var(--red)] space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[15px] text-[var(--red)]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>
                {isAr
                  ? "انتهت مدة اشتراكك وتم تعطيل الحساب تلقائياً"
                  : "Subscription Period Ended — Account Auto-Deactivated"}
              </span>
            </div>
            <p className="text-[12px] text-[var(--label-2)] leading-relaxed">
              {isAr
                ? `انتهت فترة باقتك بتاريخ ${activeTenant ? new Date(activeTenant.currentPeriodEnd).toLocaleDateString("ar-EG") : ""}. جميع معاملاتك وبياناتك محفوظة بالكامل وبأمان — اختر باقة التجديد بالأسفل لإعادة تفعيل حسابك.`
                : "Your subscription period has ended and access was automatically paused. All your financial data is safely preserved — renew below to reactivate."}
            </p>
          </div>
        )}

        {reason === "suspended" && (
          <div className="p-4 rounded-2xl bg-[var(--red-soft)] border border-[var(--red)] space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[15px] text-[var(--red)]">
              <Lock className="w-5 h-5 shrink-0" />
              <span>{isAr ? "تم إيقاف الحساب مؤقتاً من إدارة المنصة" : "Account Suspended by Admin"}</span>
            </div>
            <p className="text-[12px] text-[var(--label-2)] leading-relaxed">
              {isAr
                ? "يمكنك إرسال طلب تجديد أو تفعيل بالأسفل أو التواصل مع مالك المنصة."
                : "You can submit a renewal payment below or contact the platform owner."}
            </p>
          </div>
        )}

        {/* Latest Rejected Notice */}
        {latestRequest?.status === "rejected" && (
          <div className="p-3.5 rounded-2xl bg-[var(--red-soft)] border border-[var(--red)] space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-[13px] text-[var(--red)]">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{isAr ? "لم يتم اعتماد الإيصال السابق" : "Previous Payment Proof Rejected"}</span>
            </div>
            {latestRequest.adminNote && (
              <p className="text-[12px] text-[var(--label)]">
                {isAr ? "ملاحظة المالك: " : "Note: "}
                <strong>{latestRequest.adminNote}</strong>
              </p>
            )}
            <p className="text-[11px] text-[var(--label-2)]">
              {isAr
                ? "يمكنك إرسال بيانات التحويل الصحيحة ورفع صورة الإيصال بالأسفل لإعادة المراجعة."
                : "Please submit the valid transfer details and screenshot below."}
            </p>
          </div>
        )}

        {/* Active Pending Payment Summary Card */}
        {hasPendingRequest && latestRequest?.status === "pending" ? (
          <div className="p-4 rounded-2xl bg-[var(--fill)] border border-[var(--sep)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold">
                {isAr ? "تفاصيل طلب الدفع المرسل" : "Submitted Payment Details"}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[var(--tint-soft)] text-[var(--tint)] text-[11px] font-bold">
                {isAr ? "بانتظار التأكيد" : "Pending Review"}
              </span>
            </div>

            <div className="text-[12px] space-y-1 text-[var(--label-2)]">
              <div>
                {isAr ? "الباقة: " : "Package: "}
                <strong className="text-[var(--label)]">
                  {formatPlanLabel(latestRequest.planCode, lang)} ({latestRequest.amountEgp}{" "}
                  {isAr ? "ج.م" : "EGP"})
                </strong>
              </div>
              <div>
                {isAr ? "وسيلة التحويل: " : "Method: "}
                <strong className="text-[var(--label)]">
                  {latestRequest.paymentMethod === "instapay"
                    ? "InstaPay"
                    : isAr
                      ? "فودافون كاش"
                      : "Vodafone Cash"}
                </strong>
              </div>
              <div>
                {isAr ? "المحوّل منه: " : "Sender: "}
                <strong className="font-mono text-[var(--label)]" dir="ltr">
                  {latestRequest.senderHandle || latestRequest.referenceCode}
                </strong>
              </div>
            </div>

            {latestProofUrl && (
              <img
                src={latestProofUrl}
                alt="Transfer proof"
                className="w-full max-h-44 object-contain rounded-xl bg-black/5 border border-[var(--sep)]"
              />
            )}

            <PillButton
              type="button"
              disabled={checkingStatus || loading}
              onClick={() => void handleManualCheck()}
              className="w-full h-10 text-[13px] justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${checkingStatus ? "animate-spin" : ""}`} />
              <span>
                {checkingStatus
                  ? isAr
                    ? "جارٍ التحقق من التفعيل…"
                    : "Checking…"
                  : isAr
                    ? "تحديث حالة تفعيل الحساب"
                    : "Check Activation Status"}
              </span>
            </PillButton>
          </div>
        ) : (
          /* Renewal / Resubmission Payment Form */
          <form onSubmit={handleSubmitRenewal} className="space-y-3.5 pt-1 border-t border-[var(--sep)]">
            <div className="font-bold text-[14px]">
              {reason === "pending_approval"
                ? isAr
                  ? "إرسال إيصال الدفع لتفعيل الحساب"
                  : "Submit Transfer Proof to Activate Account"
                : isAr
                  ? "تجديد الاشتراك وإعادة تفعيل الحساب"
                  : "Renew Subscription & Reactivate Account"}
            </div>

            {/* 4 Packages Grid */}
            <div className="grid grid-cols-2 gap-2">
              {availablePlans.map((p) => {
                const active = selectedPlan === p.code;
                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setSelectedPlan(p.code)}
                    className={`relative p-2.5 rounded-2xl border text-start transition ${
                      active
                        ? "border-[var(--tint)] bg-[var(--tint-soft)] ring-1 ring-[var(--tint)]"
                        : "border-[var(--sep)] bg-[var(--fill)]"
                    }`}
                  >
                    {p.code === "yearly" && (
                      <span className="absolute -top-2 end-2 px-1.5 py-0.5 rounded-full bg-[var(--tint)] text-white text-[9px] font-bold flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5" />
                        {isAr ? "الأوفر" : "Best"}
                      </span>
                    )}
                    <div className="text-[12px] font-bold">{formatPlanLabel(p.code, lang)}</div>
                    <div className="text-[18px] font-extrabold">
                      {p.priceEgp}{" "}
                      <span className="text-[11px] font-normal text-[var(--label-3)]">
                        {isAr ? "ج.م" : "EGP"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Method Selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayMethod("instapay")}
                className={`h-9 rounded-xl text-[12px] font-bold border ${
                  payMethod === "instapay"
                    ? "border-[var(--tint)] bg-[var(--tint-soft)] text-[var(--tint)]"
                    : "border-[var(--sep)] bg-[var(--fill)]"
                }`}
              >
                InstaPay
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("vodafone_cash")}
                className={`h-9 rounded-xl text-[12px] font-bold border ${
                  payMethod === "vodafone_cash"
                    ? "border-[var(--tint)] bg-[var(--tint-soft)] text-[var(--tint)]"
                    : "border-[var(--sep)] bg-[var(--fill)]"
                }`}
              >
                {isAr ? "فودافون كاش" : "Vodafone Cash"}
              </button>
            </div>

            {/* Owner Receiver Handle */}
            {(billingInfo?.instapayHandle || billingInfo?.vodafoneCashNumber) && (
              <div className="p-3 rounded-2xl bg-[var(--fill)] border border-[var(--sep)] space-y-1.5">
                <div className="text-[11px] text-[var(--label-2)]">
                  {isAr
                    ? `حوّل ${currentPlanObj.priceEgp} ج.م إلى حساب الإدارة:`
                    : `Transfer ${currentPlanObj.priceEgp} EGP to:`}
                </div>
                {payMethod === "instapay" && billingInfo.instapayHandle && (
                  <div className="flex items-center justify-between gap-2">
                    <strong className="font-mono text-[13px]" dir="ltr">
                      {billingInfo.instapayHandle}
                    </strong>
                    <button
                      type="button"
                      onClick={() => void copyText(billingInfo.instapayHandle, "عنوان إنستا باي")}
                      className="h-7 px-2 rounded-lg bg-[var(--surface)] text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {isAr ? "نسخ" : "Copy"}
                    </button>
                  </div>
                )}
                {payMethod === "vodafone_cash" && billingInfo.vodafoneCashNumber && (
                  <div className="flex items-center justify-between gap-2">
                    <strong className="font-mono text-[14px]" dir="ltr">
                      {billingInfo.vodafoneCashNumber}
                    </strong>
                    <button
                      type="button"
                      onClick={() => void copyText(billingInfo.vodafoneCashNumber, "الرقم")}
                      className="h-7 px-2 rounded-lg bg-[var(--surface)] text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {isAr ? "نسخ" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            )}

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
                value={senderHandle}
                onChange={(e) => setSenderHandle(e.target.value)}
                placeholder={payMethod === "instapay" ? "username@instapay / 010xxxxxxxx" : "010xxxxxxxx"}
                className="w-full h-10 px-3 rounded-xl bg-[var(--fill)] text-[13px] font-mono"
                required
              />
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleSelectProof(e)}
              className="hidden"
            />
            {!proofDataUrl ? (
              <button
                type="button"
                disabled={compressing}
                onClick={() => fileRef.current?.click()}
                className="w-full py-4 px-3 rounded-2xl border-2 border-dashed border-[var(--sep)] bg-[var(--fill)] flex flex-col items-center gap-1"
              >
                <ImagePlus className="w-6 h-6 text-[var(--tint)]" />
                <span className="text-[12px] font-bold">
                  {compressing
                    ? isAr
                      ? "جارٍ تجهيز الصورة…"
                      : "Processing…"
                    : isAr
                      ? "ارفع صورة إيصال التحويل *"
                      : "Upload Transfer Screenshot *"}
                </span>
              </button>
            ) : (
              <div className="p-2 rounded-2xl bg-[var(--fill)] border border-[var(--tint)] space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--green)] font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    {isAr ? "تم إرفاق الإيصال" : "Receipt attached"}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="px-2 py-0.5 rounded bg-[var(--surface)] font-semibold flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" />
                    {isAr ? "تغيير" : "Change"}
                  </button>
                </div>
                <img src={proofDataUrl} alt="Proof" className="w-full max-h-40 object-contain rounded-xl" />
              </div>
            )}

            <PillButton
              type="submit"
              disabled={submitting || compressing}
              className="w-full h-11 text-[13px] justify-center"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {submitting
                  ? isAr
                    ? "جارٍ الإرسال…"
                    : "Submitting…"
                  : isAr
                    ? "تم الدفع — إرسال طلب التفعيل للمالك"
                    : "Payment Sent — Submit for Activation"}
              </span>
            </PillButton>
          </form>
        )}
      </div>
    </div>
  );
}
