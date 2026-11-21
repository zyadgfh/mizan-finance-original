import { Download, ShieldAlert, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PillButton } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { isNativeMobileApp, openExternalUrlSafe } from "@/lib/mobile-safe";
import {
  checkLatestApkUpdate,
  dismissApkUpdate,
  MANUAL_APK_UPDATE_EVENT,
  type ApkUpdateInfo,
} from "@/lib/update/apk-updater";

export function ApkUpdateBanner() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [update, setUpdate] = useState<ApkUpdateInfo | null>(null);

  const runCheck = useCallback(
    async (manual = false) => {
      if (!isNativeMobileApp()) return;
      const info = await checkLatestApkUpdate({ force: manual });
      if (info) {
        setUpdate(info);
      } else if (manual) {
        toast.success(
          isAr ? "أنت على أحدث إصدار من تطبيق ميزان" : "Mizan is already up to date",
        );
      }
    },
    [isAr],
  );

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void runCheck(false);
    }, 1400);

    const onManual = () => {
      void runCheck(true);
    };
    window.addEventListener(MANUAL_APK_UPDATE_EVENT, onManual);

    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener(MANUAL_APK_UPDATE_EVENT, onManual);
    };
  }, [runCheck]);

  if (!update) return null;

  const handleDownload = () => {
    const ok = openExternalUrlSafe(update.downloadUrl);
    if (!ok) {
      toast.error(
        isAr
          ? "تعذّر فتح رابط التحديث، حاول مرة أخرى"
          : "Could not open the update download link",
      );
    }
  };

  const handleDismiss = () => {
    if (update.critical) return;
    dismissApkUpdate(update.latestVersion);
    setUpdate(null);
  };

  if (update.critical) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mizan-critical-update-title"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-5 backdrop-blur-md"
      >
        <div className="w-full max-w-md rounded-3xl border border-[var(--red)] bg-[var(--surface)] p-6 text-center shadow-2xl space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--red-soft)] text-[var(--red)]">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <span className="inline-block rounded-full bg-[var(--red-soft)] px-3 py-0.5 text-[11px] font-bold text-[var(--red)]">
              {isAr ? "تحديث أمني إلزامي" : "Mandatory Update"} · {update.tagName}
            </span>
            <h2 id="mizan-critical-update-title" className="text-[18px] font-bold text-[var(--label)]">
              {isAr ? "يلزم تحديث تطبيق ميزان للمتابعة" : "Update Required to Continue"}
            </h2>
            <p className="text-[13px] text-[var(--label-2)] leading-relaxed">
              {update.notes ||
                (isAr
                  ? "يتضمن هذا الإصدار تحسينات حرجة للأمان والمزامنة. قم بتحميل النسخة الجديدة وتثبيتها للمتابعة."
                  : "This version includes critical security and sync fixes. Download and install to continue.")}
            </p>
          </div>
          <div className="text-[11px] text-[var(--label-3)] font-mono" dir="ltr">
            v{update.currentVersion} → {update.tagName}
          </div>
          <PillButton onClick={handleDownload} className="w-full h-11 justify-center text-[14px]">
            <Download className="h-4 w-4" />
            <span>{isAr ? "تحميل التحديث الإجباري الآن" : "Download Required Update"}</span>
          </PillButton>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={isAr ? "إشعار توفر تحديث جديد" : "App update available"}
      className="fixed inset-x-3 top-3 z-[65] mx-auto max-w-md rounded-2xl border border-[var(--tint)] bg-[var(--surface)] p-3.5 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-soft)] text-[var(--tint)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold text-[var(--label)]">
              {isAr ? `يتوفر تحديث جديد (${update.tagName})` : `Update Available (${update.tagName})`}
            </p>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={isAr ? "تأجيل التحديث" : "Dismiss update"}
              className="rounded-full p-1 text-[var(--label-3)] hover:bg-[var(--fill)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {update.notes ? (
            <p className="line-clamp-2 text-[11px] text-[var(--label-2)] leading-relaxed">
              {update.notes}
            </p>
          ) : null}
          <div className="flex items-center gap-2 pt-1.5">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--tint)] px-3 text-[12px] font-bold text-white"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isAr ? "تحميل التحديث" : "Update Now"}</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="h-8 rounded-xl bg-[var(--fill)] px-3 text-[11px] font-semibold text-[var(--label-2)]"
            >
              {isAr ? "لاحقاً" : "Later"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
