/* eslint-disable react-refresh/only-export-components */
import {
  Banknote,
  Building2,
  Check,
  CreditCard,
  Moon,
  Palette,
  Pencil,
  Smartphone,
  Sparkles,
  Sun,
  SunMoon,
  Wallet as WalletIcon,
  Wifi,
} from "lucide-react";
import { Amount, PillButton } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/finance/i18n";
import {
  APPLE_THEMES,
  updateUiPrefs,
  useUiPrefs,
  type AppearanceMode,
} from "@/lib/finance/prefs";
import type { Currency, Wallet, WalletCardDesign, WalletKind } from "@/lib/finance/types";

export type CardDesignSpec = {
  id: WalletCardDesign;
  nameAr: string;
  nameEn: string;
  background: string;
  textColor: string;
  subColor: string;
  badgeBg: string;
  chipStyle: string;
};

export const WALLET_CARD_DESIGNS: readonly CardDesignSpec[] = [
  {
    id: "titanium-dark",
    nameAr: "تيتانيوم أسود",
    nameEn: "Dark Titanium",
    background: "linear-gradient(135deg, #1c1e24 0%, #2f333d 48%, #121418 100%)",
    textColor: "#f8fafc",
    subColor: "rgba(241, 245, 249, 0.72)",
    badgeBg: "rgba(255, 255, 255, 0.14)",
    chipStyle: "linear-gradient(135deg, #e5c985 0%, #b89146 100%)",
  },
  {
    id: "apple-white",
    nameAr: "Apple Card الأبيض",
    nameEn: "Apple Card White",
    background: "linear-gradient(135deg, #ffffff 0%, #f1f4f9 52%, #e4e9f2 100%)",
    textColor: "#0f172a",
    subColor: "rgba(15, 23, 42, 0.64)",
    badgeBg: "rgba(15, 23, 42, 0.08)",
    chipStyle: "linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)",
  },
  {
    id: "ocean-blue",
    nameAr: "أزرق كوبرتينو",
    nameEn: "Cupertino Ocean",
    background: "linear-gradient(135deg, #0055d4 0%, #007aff 52%, #38bdf8 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.78)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fde68a 0%, #eab308 100%)",
  },
  {
    id: "emerald-cash",
    nameAr: "Apple Cash الزمردي",
    nameEn: "Emerald Cash",
    background: "linear-gradient(135deg, #065f46 0%, #059669 52%, #34d399 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.8)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fef3c7 0%, #f59e0b 100%)",
  },
  {
    id: "royal-purple",
    nameAr: "بنفسجي إنستاباي",
    nameEn: "InstaPay Violet",
    background: "linear-gradient(135deg, #4c1d95 0%, #6d28d9 52%, #a855f7 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.8)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fde68a 0%, #d97706 100%)",
  },
  {
    id: "crimson-vodafone",
    nameAr: "ياقوتي فودافون",
    nameEn: "Ruby Cash",
    background: "linear-gradient(135deg, #991b1b 0%, #dc2626 55%, #fb7185 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.8)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fef08a 0%, #ca8a04 100%)",
  },
  {
    id: "sunset-gold",
    nameAr: "ذهبي بريميوم",
    nameEn: "Champagne Gold",
    background: "linear-gradient(135deg, #78350f 0%, #b45309 48%, #f59e0b 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.82)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fef9c3 0%, #eab308 100%)",
  },
  {
    id: "rose-quartz",
    nameAr: "وردي كوارتز",
    nameEn: "Rose Quartz",
    background: "linear-gradient(135deg, #831843 0%, #db2777 52%, #f472b6 100%)",
    textColor: "#ffffff",
    subColor: "rgba(255, 255, 255, 0.82)",
    badgeBg: "rgba(255, 255, 255, 0.18)",
    chipStyle: "linear-gradient(135deg, #fef3c7 0%, #f59e0b 100%)",
  },
] as const;

export function defaultCardDesignForKind(kind: WalletKind): WalletCardDesign {
  switch (kind) {
    case "cash":
      return "emerald-cash";
    case "instapay":
      return "royal-purple";
    case "vodafone":
      return "crimson-vodafone";
    case "bank":
      return "ocean-blue";
    case "card":
      return "titanium-dark";
    default:
      return "apple-white";
  }
}

export function getWalletCardDesignSpec(wallet: Pick<Wallet, "kind" | "cardDesign">): CardDesignSpec {
  const target = wallet.cardDesign ?? defaultCardDesignForKind(wallet.kind);
  return WALLET_CARD_DESIGNS.find((d) => d.id === target) ?? WALLET_CARD_DESIGNS[0]!;
}

export function walletKindLabelText(kind: WalletKind, lang: "ar" | "en"): string {
  if (lang === "en") {
    switch (kind) {
      case "cash":
        return "Cash Wallet";
      case "instapay":
        return "InstaPay";
      case "vodafone":
        return "Mobile Wallet";
      case "bank":
        return "Bank Account";
      case "card":
        return "Bank Card";
      default:
        return "Other Wallet";
    }
  }
  switch (kind) {
    case "cash":
      return "محفظة كاش";
    case "instapay":
      return "إنستاباي";
    case "vodafone":
      return "محفظة إلكترونية";
    case "bank":
      return "حساب بنكي";
    case "card":
      return "بطاقة بنكية";
    default:
      return "محفظة أخرى";
  }
}

function WalletKindGlyph({ kind, size = 15 }: { kind: WalletKind; size?: number }) {
  switch (kind) {
    case "cash":
      return <Banknote size={size} />;
    case "instapay":
    case "vodafone":
      return <Smartphone size={size} />;
    case "bank":
      return <Building2 size={size} />;
    case "card":
      return <CreditCard size={size} />;
    default:
      return <WalletIcon size={size} />;
  }
}

export function AppleWalletCard({
  wallet,
  balance,
  currency,
  compact = false,
  onOpen,
  onEdit,
}: {
  wallet: Wallet;
  balance: number;
  currency: Currency;
  compact?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
}) {
  const { lang } = useI18n();
  const spec = getWalletCardDesignSpec(wallet);
  const isLightCard = spec.id === "apple-white";

  if (compact) {
    return (
      <div
        className="apple-wallet-card relative min-w-[205px] shrink-0 select-none p-3.5 lg:min-w-0"
        style={{ background: spec.background, color: spec.textColor }}
      >
        <div className="relative z-10 flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-start focus:outline-none"
          >
            <span
              className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: spec.badgeBg, color: spec.textColor }}
            >
              <WalletKindGlyph kind={wallet.kind} size={12} />
              <span>{walletKindLabelText(wallet.kind, lang)}</span>
            </span>
            <span className="mt-2 block truncate text-[15px] font-bold leading-tight">
              {wallet.name}
            </span>
            {wallet.subtitle || wallet.last4 ? (
              <span
                className="mt-0.5 block truncate text-[11px] font-medium"
                style={{ color: spec.subColor }}
              >
                {wallet.subtitle ? wallet.subtitle : ""}
                {wallet.subtitle && wallet.last4 ? " · " : ""}
                {wallet.last4 ? `•••• ${wallet.last4}` : ""}
              </span>
            ) : null}
          </button>

          {onEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label={
                lang === "en"
                  ? `Edit ${wallet.name} name and card style`
                  : `تعديل اسم وتصميم ${wallet.name}`
              }
              title={lang === "en" ? "Edit name & style" : "تعديل الاسم والتصميم"}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-semibold transition active:scale-95"
              style={{
                background: spec.badgeBg,
                color: spec.textColor,
                border: isLightCard
                  ? "0.5px solid rgba(15,23,42,0.12)"
                  : "0.5px solid rgba(255,255,255,0.22)",
              }}
            >
              <Pencil size={11} strokeWidth={2.3} />
              <span>{lang === "en" ? "Rename" : "تعديل"}</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="relative z-10 mt-3.5 flex w-full items-end justify-between gap-2 text-start"
        >
          <div>
            <span className="block text-[10px] font-medium" style={{ color: spec.subColor }}>
              {lang === "en" ? "Available Balance" : "الرصيد الحالي"}
            </span>
            <Amount
              value={balance}
              currency={currency}
              sign="none"
              className="!text-[17px] font-bold tracking-tight !text-inherit"
            />
          </div>
          <span
            className="h-5 w-7 shrink-0 rounded-[5px] opacity-90"
            style={{ background: spec.chipStyle }}
            aria-hidden
          />
        </button>
      </div>
    );
  }

  return (
    <div
      className="apple-wallet-card relative select-none p-5"
      style={{ background: spec.background, color: spec.textColor }}
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: spec.badgeBg, color: spec.textColor }}
            >
              <WalletKindGlyph kind={wallet.kind} size={13} />
              <span>{walletKindLabelText(wallet.kind, lang)}</span>
            </span>
            {wallet.last4 ? (
              <span
                dir="ltr"
                className="num text-[12px] font-semibold tracking-wider"
                style={{ color: spec.subColor }}
              >
                •••• {wallet.last4}
              </span>
            ) : null}
          </div>
          <h3 className="mt-2.5 truncate text-[20px] font-bold leading-snug">{wallet.name}</h3>
          {wallet.subtitle ? (
            <p className="mt-0.5 truncate text-[12px] font-medium" style={{ color: spec.subColor }}>
              {wallet.subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-semibold transition active:scale-95"
              style={{
                background: spec.badgeBg,
                color: spec.textColor,
                border: isLightCard
                  ? "0.5px solid rgba(15,23,42,0.14)"
                  : "0.5px solid rgba(255,255,255,0.24)",
              }}
            >
              <Pencil size={13} strokeWidth={2.2} />
              <span>{lang === "en" ? "Edit Name" : "تعديل الاسم"}</span>
            </button>
          ) : (
            <Wifi size={18} className="rotate-90 opacity-75" />
          )}
        </div>
      </div>

      <div className="relative z-10 mt-6 flex items-end justify-between gap-3">
        <div>
          <span className="block text-[11px] font-medium" style={{ color: spec.subColor }}>
            {lang === "en" ? "Current Balance" : "الرصيد المتاح"}
          </span>
          <Amount
            value={balance}
            currency={currency}
            sign="none"
            className="mt-0.5 block !text-[24px] font-extrabold tracking-tight !text-inherit"
          />
        </div>
        <div className="flex items-center gap-2">
          <Wifi size={16} className="rotate-90 opacity-65" aria-hidden />
          <span
            className="h-6 w-9 rounded-[6px] shadow-inner"
            style={{ background: spec.chipStyle }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

export function AppleDesignStudioContent({
  wallets,
  onEditWallet,
  onAddWallet,
}: {
  wallets?: Wallet[];
  onEditWallet?: (walletId: string) => void;
  onAddWallet?: () => void;
}) {
  const prefs = useUiPrefs();
  const { lang } = useI18n();

  const modes: { id: AppearanceMode; labelAr: string; labelEn: string; icon: typeof Sun }[] = [
    { id: "system", labelAr: "تلقائي", labelEn: "Auto", icon: SunMoon },
    { id: "light", labelAr: "فاتح", labelEn: "Light", icon: Sun },
    { id: "dark", labelAr: "داكن", labelEn: "Dark", icon: Moon },
  ];

  return (
    <div className="space-y-5 px-4 pt-2 pb-4">
      {/* Banner */}
      <div className="surface-card relative overflow-hidden rounded-card p-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
            style={{
              background:
                APPLE_THEMES.find((t) => t.id === prefs.appleTheme)?.swatch ??
                "linear-gradient(135deg, #007AFF, #5AC8FA)",
            }}
          >
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[16px] font-bold">
                {lang === "en" ? "Apple Design Studio" : "استوديو تصميمات Apple"}
              </h3>
              <span className="rounded-pill bg-[var(--tint-soft)] px-2 py-0.5 text-[10px] font-bold text-tint">
                /appledesign1
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-label-2">
              {lang === "en"
                ? "Switch instantly between 6 signature Apple themes & customize card names"
                : "اختر من 6 تصميمات مستوحاة من Apple وعدّل أسماء وألوان بطاقاتك ومحافظك بضغطة واحدة"}
            </p>
          </div>
        </div>

        {/* Light / Dark / System Mode */}
        <div className="mt-4 grid grid-cols-3 gap-1.5 rounded-cell bg-fill p-1">
          {modes.map((m) => {
            const Icon = m.icon;
            const active = prefs.colorMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => updateUiPrefs({ colorMode: m.id })}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-1.5 rounded-inner px-2 text-[13px] font-semibold transition",
                  active ? "bg-cell text-label shadow-sm" : "text-label-2",
                )}
              >
                <Icon size={15} />
                <span>{lang === "en" ? m.labelEn : m.labelAr}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6 Apple Themes Grid */}
      <div>
        <h4 className="px-2 pb-2 text-[13px] font-semibold text-label-2">
          {lang === "en" ? "Choose Design Theme (/appledesign1)" : "اختر التصميم البصري (/appledesign1)"}
        </h4>
        <div className="grid grid-cols-2 gap-2.5">
          {APPLE_THEMES.map((theme) => {
            const selected = prefs.appleTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => updateUiPrefs({ appleTheme: theme.id })}
                className={cn(
                  "surface-card relative flex flex-col items-start rounded-cell p-3 text-start transition",
                  selected
                    ? "ring-2 ring-[var(--tint)]"
                    : "opacity-90 hover:opacity-100",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className="h-7 w-11 rounded-lg shadow-sm"
                    style={{ background: theme.swatch }}
                  />
                  {selected ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-tint text-on-tint">
                      <Check size={13} strokeWidth={2.6} />
                    </span>
                  ) : null}
                </div>
                <span className="mt-2.5 block text-[14px] font-bold leading-snug text-label">
                  {lang === "en" ? theme.nameEn : theme.nameAr}
                </span>
                <span className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-label-2">
                  {lang === "en" ? theme.subEn : theme.subAr}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Section Header + Quick Rename for All Cards & Wallets */}
      <div className="surface-card rounded-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Palette size={17} className="text-tint" />
            <h4 className="text-[14px] font-bold">
              {lang === "en" ? "Cards & Wallets Names" : "تعديل أسماء البطاقات والمحافظ"}
            </h4>
          </div>
          {onAddWallet ? (
            <PillButton tone="gray" className="!min-h-8 !px-3 !text-[12px]" onClick={onAddWallet}>
              {lang === "en" ? "+ Add Card" : "+ بطاقة / محفظة"}
            </PillButton>
          ) : null}
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-label-2">
            {lang === "en" ? "Home Cards Section Title" : "عنوان قسم البطاقات في الرئيسية"}
          </span>
          <input
            className="field rounded-inner bg-fill px-3 !text-[14px]"
            value={prefs.cardsSectionTitle}
            placeholder={lang === "en" ? "My Cards & Wallets" : "بطاقاتي ومحافظي"}
            onChange={(e) => updateUiPrefs({ cardsSectionTitle: e.target.value })}
          />
        </label>

        {wallets && wallets.length > 0 && onEditWallet ? (
          <div className="mt-3 space-y-2">
            <span className="block text-[12px] font-medium text-label-2">
              {lang === "en"
                ? "Tap any card or wallet to rename or change its color:"
                : "اضغط «تعديل الاسم» بجانب أي بطاقة أو محفظة لتغيير اسمها أو تصميمها:"}
            </span>
            {wallets.map((w) => {
              const spec = getWalletCardDesignSpec(w);
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-2 rounded-inner bg-fill px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-7 w-10 shrink-0 rounded-md shadow-sm"
                      style={{ background: spec.background }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-label">{w.name}</p>
                      <p className="truncate text-[11px] text-label-2">
                        {walletKindLabelText(w.kind, lang)}
                        {w.last4 ? ` · •••• ${w.last4}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEditWallet(w.id)}
                    className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-pill bg-tint px-3 py-1.5 text-[12px] font-semibold text-on-tint active:opacity-80"
                  >
                    <Pencil size={12} />
                    <span>{lang === "en" ? "Rename" : "تعديل الاسم"}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
