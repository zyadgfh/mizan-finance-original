import { EyeOff, Fingerprint, HardDrive, KeyRound, Lock, ShieldCheck, Trash2, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { Group, PillButton, Row, Section } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import {
  isBiometricSupported,
  registerBiometricCredential,
  updateSecuritySettings,
  useSecuritySettings,
  type AutoLockTimeout,
} from "@/lib/finance/security";
import { getConfiguredGoogleClientId, loadDriveSyncPrefs } from "@/lib/sync/google-drive-gis";
import { updateMyPassword } from "@/lib/tenant/api";

const TIMEOUT_OPTIONS: { value: AutoLockTimeout; label: string }[] = [
  { value: 0, label: "فوراً" },
  { value: 1, label: "1 د" },
  { value: 5, label: "5 د" },
  { value: 15, label: "15 د" },
  { value: -1, label: "إيقاف" },
];

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("h-7 w-12 shrink-0 rounded-pill p-0.5 disabled:opacity-40", on ? "bg-tint" : "bg-fill")}
    >
      <span className={cn("block h-6 w-6 rounded-pill bg-cell", on && "ms-auto")} />
    </button>
  );
}

export function SecurityScreen() {
  const { openSheet, pinHash } = useMizan();
  const security = useSecuritySettings();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [nextPass, setNextPass] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const driveConfigured = Boolean(getConfiguredGoogleClientId());
  const drivePrefs = loadDriveSyncPrefs();

  async function handleChangeAccountPassword(e: React.FormEvent) {
    e.preventDefault();
    if (nextPass.trim().length < 6) {
      toast.error("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
      return;
    }
    setPassBusy(true);
    try {
      await updateMyPassword(nextPass.trim());
      setNextPass("");
      toast.success("تم تحديث كلمة مرور الحساب بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تحديث كلمة المرور");
    } finally {
      setPassBusy(false);
    }
  }

  useEffect(() => {
    void isBiometricSupported().then(setBioAvailable);
  }, []);

  async function toggleBiometrics(next: boolean) {
    if (!next) {
      updateSecuritySettings({ biometricEnabled: false, biometricCredentialId: undefined });
      toast("تم إيقاف القفل بالبصمة");
      return;
    }
    if (!pinHash) {
      toast("اضبط رمز PIN أولاً كخيار احتياطي");
      openSheet({ kind: "pin" });
      return;
    }
    setBioBusy(true);
    try {
      const credId = await registerBiometricCredential();
      updateSecuritySettings({ biometricEnabled: true, biometricCredentialId: credId });
      toast.success("تم تفعيل الفتح بالبصمة / الوجه");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تفعيل المصادقة الحيوية");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">الأمان والخصوصية</h1>
        <p className="mt-1 text-sub text-label-2">تحكّم في قفل التطبيق وإخفاء البيانات وشفافية التخزين.</p>
      </div>

      <Section title="كلمة مرور الحساب السحابي">
        <Group sep="icon">
          <form onSubmit={handleChangeAccountPassword} className="p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-body font-semibold">
              <KeyRound size={16} className="text-tint" />
              <span>تغيير كلمة مرور الدخول</span>
            </div>
            <p className="text-foot text-label-2">
              يمكنك تغيير كلمة المرور المبدئية المسلّمة لك من مالك المنصة في أي وقت.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                dir="ltr"
                minLength={6}
                value={nextPass}
                onChange={(e) => setNextPass(e.target.value)}
                placeholder="كلمة المرور الجديدة (6+ أحرف)"
                className="flex-1 h-10 px-3 rounded-inner bg-fill text-body"
              />
              <PillButton type="submit" disabled={passBusy || nextPass.trim().length < 6}>
                <span>{passBusy ? "جارٍ الحفظ..." : "تحديث"}</span>
              </PillButton>
            </div>
          </form>
        </Group>
      </Section>

      <Section title="قفل التطبيق والحماية الحيوية">
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: pinHash ? "var(--green)" : "var(--tint)" }}>
                <Lock size={16} />
              </span>
            }
            title={pinHash ? "رمز PIN مفعّل (4 خانات)" : "تعيين رمز PIN"}
            sub={pinHash ? "اضغط لتغيير الرمز أو إلغائه" : "يحمي فتح الدفتر على هذا الجهاز"}
            chevron
            onClick={() => openSheet({ kind: "pin" })}
          />
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--tint)" }}>
                <Fingerprint size={16} />
              </span>
            }
            title="الفتح بالبصمة أو الوجه"
            sub={
              bioAvailable
                ? "فتح التطبيق ببصمة الجهاز أو الوجه، ويبقى رمز PIN احتياطياً"
                : "لا توجد بصمة مسجّلة على هذا الجهاز — أضف بصمة من إعدادات النظام ثم أعد المحاولة"
            }
            trailing={
              <Switch
                on={security.biometricEnabled}
                disabled={bioBusy || !bioAvailable}
                onChange={(v) => void toggleBiometrics(v)}
                label="تفعيل البصمة"
              />
            }
          />
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body">مهلة القفل التلقائي</span>
              <span className="text-foot text-label-2">{pinHash ? "عند الخمول أو الخلفية" : "فعّل PIN أولاً"}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {TIMEOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!pinHash}
                  onClick={() => {
                    updateSecuritySettings({ autoLockMinutes: opt.value });
                    toast(`ضُبط القفل التلقائي: ${opt.label}`);
                  }}
                  className={cn(
                    "min-h-9 rounded-pill px-3 text-caption font-semibold disabled:opacity-40",
                    security.autoLockMinutes === opt.value ? "bg-tint text-on-tint" : "bg-fill text-label-2",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </Group>
      </Section>

      <Section title="إخفاء البيانات والخصوصية">
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--orange)" }}>
                <ShieldCheck size={16} />
              </span>
            }
            title="إخفاء الأرصدة في التطبيقات الأخيرة"
            sub="تمويه الشاشة عند الخروج وتفعيل FLAG_SECURE على Android"
            trailing={
              <Switch
                on={security.hideBalancesInRecents}
                onChange={(v) => updateSecuritySettings({ hideBalancesInRecents: v })}
                label="إخفاء الأرصدة في التطبيقات الأخيرة"
              />
            }
          />
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--gray)" }}>
                <EyeOff size={16} />
              </span>
            }
            title="إخفاء مبالغ المعاملات والأرصدة"
            sub="يستبدل الأرقام بـ •••• في الشاشات والقوائم"
            trailing={
              <Switch
                on={security.hideAmounts}
                onChange={(v) => updateSecuritySettings({ hideAmounts: v })}
                label="إخفاء المبالغ"
              />
            }
          />
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--gray)" }}>
                <UserX size={16} />
              </span>
            }
            title="إخفاء أسماء الأشخاص"
            sub="يعرض الحرف الأول فقط بدل الاسم الكامل في القوائم"
            trailing={
              <Switch
                on={security.hidePeopleNames}
                onChange={(v) => updateSecuritySettings({ hidePeopleNames: v })}
                label="إخفاء أسماء الأشخاص"
              />
            }
          />
        </Group>
      </Section>

      <Section title="أين تُحفظ بياناتك؟ (الشفافية الكاملة)">
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--green)" }}>
                <HardDrive size={16} />
              </span>
            }
            title="التخزين المحلي على جهازك"
            sub="الحركات والديون والميزانيات في localStorage، صور الإيصالات في IndexedDB، وبصمة PIN أحادية الاتجاه SHA-256."
          />
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--tint)" }}>
                <ShieldCheck size={16} />
              </span>
            }
            title="المزامنة السحابية (Google Drive)"
            sub={
              driveConfigured
                ? `اختيارية داخل مجلد appDataFolder الخاص بالتطبيق فقط${drivePrefs.encryptBackup ? " · التشفير المسبق AES-GCM مفعّل" : " · يمكنك تفعيل كلمة مرور تشفير قبل الرفع"}.`
                : "غير مفعّلة حالياً — لا يتم رفع أي بيانات خارج جهازك."
            }
          />
        </Group>
      </Section>

      <Section title="مسح آمن" footer="يكتب أصفاراً فوق مفاتيح التخزين ثم يحذف الدفتر والإيصالات ورمز PIN والمهام وجلسة Drive.">
        <div className="px-4">
          <PillButton tone="danger" onClick={() => openSheet({ kind: "reset" })}>
            <Trash2 size={16} />
            <span>حذف البيانات المحلية بشكل آمن</span>
          </PillButton>
        </div>
      </Section>
    </div>
  );
}
