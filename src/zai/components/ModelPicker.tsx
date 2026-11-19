// File: src/zai/components/ModelPicker.tsx
// Model Picker: desktop popover anchored to the model pill, mobile bottom sheet
// with grabber + swipe-to-dismiss (handled by <Sheet variant>). Tabs: موصى بها/
// مفضلة/سريعة/تفكير/برمجة/رؤية/بحث/كل النماذج. Search + "no results" state.
// Info button opens a details card. Remembers last model per chat via onPick.
import { useMemo, useState } from "react";
import { Info, Search, Star, X, Zap, Brain, Code2, Eye, Globe2 } from "lucide-react";
import { Sheet } from "./Sheet";
import { MODELS, PROVIDER_NAME } from "../models";
import { normalizeArabic } from "../lib/search";
import { useZai } from "../lib/store";
import type { ModelDef } from "../types";

const TABS = [
  { id: "rec", label: "موصى بها", icon: Star },
  { id: "fav", label: "مفضلة", icon: Star },
  { id: "fast", label: "سريعة", icon: Zap },
  { id: "think", label: "تفكير", icon: Brain },
  { id: "code", label: "برمجة", icon: Code2 },
  { id: "vision", label: "رؤية", icon: Eye },
  { id: "search", label: "بحث", icon: Globe2 },
  { id: "all", label: "كل النماذج", icon: Globe2 },
] as const;

function useIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= 768;
}

export function ModelPicker({ open, onClose, anchorRef, onPick }: {
  open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null>; onPick: (id: string) => void;
}) {
  const { settings, favs, toggleFav, usage, lat, bad } = useZai();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("rec");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<ModelDef | null>(null);
  const mobile = useIsMobile();

  const list = useMemo(() => {
    let base = MODELS;
    if (tab === "rec") base = MODELS.filter((m) => m.recommended);
    else if (tab === "fav") base = MODELS.filter((m) => favs.includes(m.id));
    else if (tab === "fast") base = MODELS.filter((m) => m.speed === "fast");
    else if (tab === "think") base = MODELS.filter((m) => m.thinking);
    else if (tab === "code") base = MODELS.filter((m) => m.category === "برمجة");
    else if (tab === "vision") base = MODELS.filter((m) => m.vision);
    else if (tab === "search") base = MODELS.filter((m) => m.category === "بحث");
    if (q.trim()) {
      const nq = normalizeArabic(q);
      base = base.filter((m) => normalizeArabic(m.name).includes(nq) || normalizeArabic(m.tag).includes(nq) || m.id.includes(q.toLowerCase()));
    }
    return base;
  }, [tab, q, favs]);

  const body = (
    <>
      <div className="zai-sheet-head">
        <h2 id="model-picker-title">اختيار النموذج</h2>
        <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ padding: "0 16px 8px" }}>
        <div style={{ position: "relative" }}>
          <Search size={16} style={{ position: "absolute", insetInlineStart: 12, top: 13, color: "var(--zai-text-secondary)" }} />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن نموذج…" aria-label="بحث عن نموذج"
            style={{ width: "100%", minHeight: 40, paddingInlineStart: 36, paddingInlineEnd: 10, borderRadius: 12, border: "1px solid var(--zai-outline)", background: "var(--zai-control)", color: "var(--zai-text-primary)" }}
          />
        </div>
      </div>
      <div className="zai-tabs" role="tablist" aria-label="تصنيفات النماذج">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`zai-tab ${tab === t.id ? "cur" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="zai-sheet-body" role="listbox" aria-label="قائمة النماذج">
        {list.length === 0 && <p style={{ textAlign: "center", color: "var(--zai-text-secondary)", padding: 24 }}>لا توجد نتائج</p>}
        {list.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              role="option" aria-selected={settings.modelId === m.id}
              className={`zai-model-opt ${settings.modelId === m.id ? "cur" : ""}`}
              onClick={() => { onPick(m.id); onClose(); }}
              disabled={bad.includes(m.id)}
              title={bad.includes(m.id) ? "غير متوفر حاليًا" : undefined}
            >
              <span className="ic" style={{ background: m.color }}>{m.name.slice(0, 1)}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <span className="mn">{m.name}</span>
                <span className="mm">{PROVIDER_NAME[m.provider]} · {m.id}</span>
              </span>
              <span className="tag">{m.tag}{usage[m.id] ? ` · ${usage[m.id]}×` : ""}</span>
            </button>
            <button className="zai-icon-btn" aria-label={`معلومات ${m.name}`} onClick={() => setDetail(m)} style={{ width: 36, height: 36 }}>
              <Info size={16} />
            </button>
            <button
              className="zai-icon-btn" aria-label={favs.includes(m.id) ? "إزالة من المفضلة" : "إضافة للمفضلة"}
              onClick={() => toggleFav(m.id)} style={{ width: 36, height: 36 }}
            >
              <Star size={16} fill={favs.includes(m.id) ? "var(--zai-primary)" : "none"} color={favs.includes(m.id) ? "var(--zai-primary)" : undefined} />
            </button>
          </div>
        ))}
      </div>
      {detail && (
        <div className="zai-sheet-foot" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <strong>{detail.name}</strong>
          <span style={{ fontSize: 12, color: "var(--zai-text-secondary)" }}>
            المزود: {PROVIDER_NAME[detail.provider]} · السرعة: {detail.speed === "fast" ? "سريعة" : detail.speed === "medium" ? "متوسطة" : "بطيئة"}
            {detail.vision ? " · يدعم الرؤية" : ""}{detail.thinking ? " · نموذج تفكير" : ""}
            {lat[detail.id] ? ` · آخر زمن استجابة ${lat[detail.id]}ms` : ""}
          </span>
          <button className="zai-btn" onClick={() => setDetail(null)}>إغلاق التفاصيل</button>
        </div>
      )}
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} variant={mobile ? "bottom" : "pop"} anchorRef={anchorRef} width={420} labelledBy="model-picker-title">
      {body}
    </Sheet>
  );
}
