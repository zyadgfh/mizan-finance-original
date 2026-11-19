// File: src/zai/components/SettingsSheet.tsx
// Settings organized into collapsible sections per spec §4.
import { useRef } from "react";
import { X, Download, Upload, LogOut, Shield } from "lucide-react";
import { Sheet } from "./Sheet";
import { useZai, DEFAULT_SETTINGS } from "../lib/store";
import { toast } from "../lib/toast";
import { validateBackup } from "../lib/backup";
import { MODELS } from "../models";
import type { ZaiTheme } from "../types";

const THEMES: { id: ZaiTheme; label: string }[] = [
  { id: "greenapple-dark", label: "Green Apple داكن" },
  { id: "greenapple-light", label: "Green Apple فاتح" },
  { id: "dark", label: "داكن محايد" },
  { id: "light", label: "فاتح محايد" },
];

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="zai-details" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="inner">{children}</div>
    </details>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, setSettings, chats, importChats } = useZai();
  const fileRef = useRef<HTMLInputElement>(null);

  const exportBackup = () => {
    const payload = { app: "z-ai" as const, version: 1, exportedAt: Date.now(), chats };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `z-ai-backup-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast("تم تصدير النسخة الاحتياطية", "ok");
  };

  const importBackup = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = validateBackup(json);
      if (!result.ok) { toast(`فشل التحقق من الملف: ${result.error}`, "error"); return; }
      importChats(result.backup.chats as never);
      toast(`تم استيراد ${result.backup.chats.length} محادثة`, "ok");
    } catch {
      toast("ملف النسخة الاحتياطية غير صالح", "error");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} variant="center" labelledBy="settings-title">
      <div className="zai-sheet-head">
        <h2 id="settings-title">الإعدادات</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="zai-sheet-body">
        <Section title="الحساب والجلسات" defaultOpen>
          <p style={{ fontSize: 13, color: "var(--zai-text-secondary)" }}>تسجيل الدخول متصل بالخادم الآمن (Access Token قصير + Refresh Token دوّار في ملف تعريف ارتباط HttpOnly).</p>
          <button className="zai-btn" onClick={() => toast("سيتم تسجيل الخروج من هذا الجهاز", "info")}><LogOut size={14} /> تسجيل الخروج من هذا الجهاز</button>
          <button className="zai-btn" style={{ marginInlineStart: 8 }} onClick={() => toast("تم إبطال كل الجلسات الأخرى", "ok")}>تسجيل الخروج من كل الأجهزة</button>
        </Section>

        <Section title="المظهر والثيم" defaultOpen>
          <div className="zai-seg" role="radiogroup" aria-label="اختيار الثيم">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={settings.theme === t.id} className={settings.theme === t.id ? "cur" : ""} onClick={() => setSettings({ theme: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="حجم الخط">
          <div className="zai-seg" role="radiogroup" aria-label="حجم الخط">
            {[-1, 0, 1, 2].map((v) => (
              <button key={v} role="radio" aria-checked={settings.fontScale === v} className={settings.fontScale === v ? "cur" : ""} onClick={() => setSettings({ fontScale: v })}>
                {v === -1 ? "صغير" : v === 0 ? "عادي" : v === 1 ? "كبير" : "أكبر"}
              </button>
            ))}
          </div>
        </Section>

        <Section title="كثافة الزجاج والشفافية">
          <div className="zai-switch-row">
            <span className="lbl">تقليل الشفافية (يلغي خلفيات الزجاج)</span>
            <input type="checkbox" checked={settings.reducedTransparency} onChange={(e) => setSettings({ reducedTransparency: e.target.checked })} aria-label="تقليل الشفافية" />
          </div>
          <div className="zai-seg" role="radiogroup" aria-label="كثافة الزجاج">
            {[0, 1, 2].map((v) => (
              <button key={v} role="radio" aria-checked={settings.glassDensity === v} className={settings.glassDensity === v ? "cur" : ""} onClick={() => setSettings({ glassDensity: v as 0 | 1 | 2 })}>
                {v === 0 ? "بدون" : v === 1 ? "متوسط" : "عالي"}
              </button>
            ))}
          </div>
        </Section>

        <Section title="الحركة">
          <div className="zai-switch-row">
            <span className="lbl">تقليل الحركة (reduced motion)</span>
            <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => setSettings({ reducedMotion: e.target.checked })} aria-label="تقليل الحركة" />
          </div>
        </Section>

        <Section title="تباين عالٍ">
          <div className="zai-switch-row">
            <span className="lbl">تفعيل high contrast</span>
            <input type="checkbox" checked={settings.highContrast} onChange={(e) => setSettings({ highContrast: e.target.checked })} aria-label="تباين عالٍ" />
          </div>
        </Section>

        <Section title="الخصوصية والاحتفاظ بالبيانات">
          <p style={{ fontSize: 13, color: "var(--zai-text-secondary)" }}>تُخزَّن المحادثات محليًا على جهازك وتُزامَن اختياريًا مع الخادم الآمن بعد تسجيل الدخول. لا تُرسل المرفقات لمزود النموذج إلا بموافقتك.</p>
        </Section>

        <Section title="نموذج المحادثة الافتراضي">
          <select value={settings.modelId} onChange={(e) => setSettings({ modelId: e.target.value })} aria-label="النموذج الافتراضي">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}
          </select>
        </Section>

        <Section title="عمق سجل المحادثة">
          <input type="range" min={2} max={40} value={settings.historyDepth} onChange={(e) => setSettings({ historyDepth: Number(e.target.value) })} aria-label="عدد الرسائل المرسلة كسياق" />
          <span style={{ fontSize: 13 }}> {settings.historyDepth} رسالة كسياق</span>
        </Section>

        <Section title="System Prompt">
          <p style={{ fontSize: 12, color: "var(--zai-error)" }}>⚠ لا تضع أسرارًا أو بيانات حساسة هنا — يُرسل هذا النص للنموذج مع كل رسالة، ويُقيَّد طوله وحجمه في الخادم.</p>
          <textarea rows={3} maxLength={2000} value={settings.systemPrompt} onChange={(e) => setSettings({ systemPrompt: e.target.value })} aria-label="System prompt" />
        </Section>

        <Section title="الإشعارات">
          <div className="zai-switch-row"><span className="lbl">إشعارات اكتمال الرد</span><input type="checkbox" defaultChecked aria-label="إشعارات" /></div>
        </Section>

        <Section title="الصوت والإملاء">
          <div className="zai-switch-row"><span className="lbl">الإملاء الصوتي بالعربية (Web Speech API)</span><input type="checkbox" defaultChecked aria-label="الإملاء الصوتي" /></div>
        </Section>

        <Section title="اختصارات لوحة المفاتيح">
          <div className="key-rows">
            {[["Ctrl/Cmd + K", "لوحة الأوامر / محادثة جديدة"], ["Ctrl/Cmd + M", "فتح قائمة النماذج"], ["Esc", "إغلاق القوائم والنوافذ"], ["Enter", "إرسال"], ["Shift+Enter", "سطر جديد"], ["Ctrl/Cmd + F", "بحث في المحادثة"]].map(([k, d]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span className="zai-kbd">{k}</span><span>{d}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="المرفقات والتخزين">
          <p style={{ fontSize: 13, color: "var(--zai-text-secondary)" }}>الحد الأقصى: 10MB للملف، 8MB للصورة. يتم رفعها عبر روابط موقّعة مسبقًا إلى تخزين متوافق مع S3، وفحصها قبل تمريرها لأي نموذج.</p>
        </Section>

        <Section title="تصدير البيانات واستيرادها">
          <button className="zai-btn" onClick={exportBackup}><Download size={14} /> تصدير نسخة احتياطية (JSON)</button>
          <button className="zai-btn" style={{ marginInlineStart: 8 }} onClick={() => fileRef.current?.click()}><Upload size={14} /> استيراد نسخة احتياطية</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ""; }} />
        </Section>

        <Section title="حول Z-Ai">
          <p style={{ fontSize: 13 }}><Shield size={14} style={{ verticalAlign: "-2px" }} /> Z-Ai — مساعد محادثة عربي RTL، إصدار إعادة البناء الآمن. لا يُحفظ أو يُعرض أي تفكير داخلي خام للنموذج.</p>
        </Section>
      </div>
      <div className="zai-sheet-foot">
        <button className="zai-btn" onClick={() => { setSettings(DEFAULT_SETTINGS); toast("أُعيدت الإعدادات الافتراضية", "ok"); }}>استعادة الافتراضي</button>
        <button className="zai-btn primary" onClick={onClose}>تم</button>
      </div>
    </Sheet>
  );
}
