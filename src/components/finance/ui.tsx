import * as Dialog from "@radix-ui/react-dialog";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/finance/i18n";
import { currencySymbol, money } from "@/lib/finance/logic";
import { maskPersonName, useSecuritySettings } from "@/lib/finance/security";
import type { Currency } from "@/lib/finance/types";
import { prefersReducedMotion } from "./motion-utils";

gsap.registerPlugin(useGSAP);

export function Amount({
  value,
  currency,
  sign = "none",
  className,
  unmasked = false,
}: {
  value: number;
  currency: Currency;
  sign?: "auto" | "plus" | "minus" | "none";
  className?: string;
  unmasked?: boolean;
}) {
  const { hideAmounts } = useSecuritySettings();
  const { lang, numeralStyle } = useI18n();
  const neg = sign === "minus" || (sign === "auto" && value < 0);
  const pos = sign === "plus" || (sign === "auto" && value > 0);
  const tone = neg ? "text-expense" : pos ? "text-income" : "text-label";
  if (hideAmounts && !unmasked) {
    return (
      <span
        dir="ltr"
        className={cn("num whitespace-nowrap", tone, className)}
        aria-label={lang === "en" ? "Hidden amount" : "مبلغ مخفي"}
      >
        •••• {currencySymbol(currency, lang)}
      </span>
    );
  }
  return (
    <span dir="ltr" className={cn("num whitespace-nowrap", tone, className)}>
      {neg ? "−" : pos ? "+" : ""}
      {money(value, currency, numeralStyle, lang)}
    </span>
  );
}

export function PersonName({ name, className }: { name: string; className?: string }) {
  const { hidePeopleNames } = useSecuritySettings();
  return <span className={className}>{maskPersonName(name, hidePeopleNames)}</span>;
}

export function Section({
  title,
  footer,
  children,
  className,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-stagger className={cn("mt-6", className)}>
      {title ? <h2 className="px-8 pb-2 text-foot font-medium text-label-2">{title}</h2> : null}
      {children}
      {footer ? <p className="px-8 pt-2 text-foot text-label-2">{footer}</p> : null}
    </section>
  );
}

export function Group({
  children,
  sep = "text",
}: {
  children: ReactNode;
  sep?: "text" | "icon" | "none";
}) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div className="surface-card mx-4 overflow-hidden rounded-cell">
      {items.map((child, i) => (
        <div key={i}>
          {i > 0 && sep !== "none" ? <div className={sep === "icon" ? "row-sep-icon" : "row-sep"} /> : null}
          {child}
        </div>
      ))}
    </div>
  );
}

export function Row({
  title,
  sub,
  leading,
  trailing,
  chevron,
  onClick,
  destructive,
}: {
  title: ReactNode;
  sub?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const { isRtl } = useI18n();
  const Chevron = isRtl ? ChevronLeft : ChevronRight;
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-start">
        <span className={cn("block truncate text-body", destructive && "text-expense")}>{title}</span>
        {sub ? <span className="block truncate text-foot text-label-2">{sub}</span> : null}
      </span>
      {trailing ? (
        <span className="flex min-w-0 max-w-[48%] shrink-0 items-center justify-end gap-1 overflow-hidden">
          {trailing}
        </span>
      ) : null}
      {chevron ? <Chevron className="shrink-0 text-label-3" size={18} strokeWidth={2} aria-hidden /> : null}
    </>
  );
  const cls = "flex min-h-11 min-w-0 w-full items-center gap-3 overflow-hidden px-4 py-2 text-start";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, "row-press")}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div data-stagger className="px-8 py-14 text-center">
      <h3 className="text-title3 font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-xs text-sub text-label-2">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PillButton({
  children,
  onClick,
  tone = "tint",
  type = "button",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "tint" | "gray" | "plain" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const tones = {
    tint: "bg-tint text-on-tint shadow-sm",
    gray: "bg-fill text-tint",
    plain: "text-tint",
    danger: "text-expense",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1 rounded-pill px-4 text-sub font-semibold active:opacity-80 disabled:opacity-40",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

const segmentCols: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mounted = useRef(false);

  const positionPill = (animate: boolean) => {
    const wrap = wrapRef.current;
    const pill = pillRef.current;
    const btn = btnRefs.current[value];
    if (!wrap || !pill || !btn) return;
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const x = btnRect.left - wrapRect.left;
    const width = btnRect.width;
    if (width <= 0) return;

    if (!animate || prefersReducedMotion()) {
      gsap.set(pill, { x, width, opacity: 1 });
    } else {
      gsap.to(pill, { x, width, opacity: 1, duration: 0.26, ease: "power3.out", overwrite: "auto" });
    }
  };

  useLayoutEffect(() => {
    positionPill(mounted.current);
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => positionPill(false));
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative grid rounded-cell bg-fill p-1", segmentCols[options.length] ?? "grid-cols-2")}
      role="tablist"
    >
      <div
        ref={pillRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-0 rounded-inner bg-cell opacity-0 shadow-sm"
      />
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              btnRefs.current[o.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "relative z-10 min-h-11 rounded-inner px-2 text-sub font-semibold",
              on ? "text-label" : "text-label-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="px-4">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field rounded-cell bg-fill px-3.5"
        aria-label={placeholder}
      />
    </div>
  );
}

export function Sheet({
  title,
  description,
  container,
  onClose,
  children,
  trailing,
}: {
  title: string;
  description: string;
  container: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const { t, dir } = useI18n();
  const [shown, setShown] = useState(false);
  const drag = useRef(false);
  const dyRef = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { contextSafe } = useGSAP(
    () => {
      if (!panel.current || !shown) return;
      if (prefersReducedMotion()) {
        gsap.set(panel.current, { y: 0 });
        if (overlay.current) gsap.set(overlay.current, { opacity: 1 });
        return;
      }
      gsap.fromTo(
        panel.current,
        { yPercent: 100 },
        { yPercent: 0, duration: 0.38, ease: "power3.out", overwrite: "auto" },
      );
      if (overlay.current) {
        gsap.fromTo(overlay.current, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "power2.out" });
      }
    },
    { scope: panel, dependencies: [shown], revertOnUpdate: true },
  );

  const close = contextSafe(() => {
    if (!panel.current || prefersReducedMotion()) {
      onClose();
      return;
    }
    if (overlay.current) {
      gsap.to(overlay.current, { opacity: 0, duration: 0.22, ease: "power2.in" });
    }
    gsap.to(panel.current, {
      yPercent: 100,
      duration: 0.25,
      ease: "power2.in",
      overwrite: "auto",
      onComplete: onClose,
    });
  });

  const updateDrag = contextSafe((next: number) => {
    if (panel.current) gsap.set(panel.current, { y: next });
    if (overlay.current) {
      const ratio = Math.max(0.15, 1 - next / 420);
      gsap.set(overlay.current, { opacity: ratio });
    }
  });

  const settleDrag = contextSafe(() => {
    if (panel.current) {
      gsap.to(panel.current, { y: 0, duration: 0.36, ease: "power3.out", overwrite: "auto" });
    }
    if (overlay.current) {
      gsap.to(overlay.current, { opacity: 1, duration: 0.25, ease: "power2.out" });
    }
  });

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay ref={overlay} className="absolute inset-0 z-40 bg-black/40" />
        <div className="pointer-events-none absolute inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6">
          <Dialog.Content
            ref={panel}
            dir={dir}
            className="sheet-panel pointer-events-auto flex w-full flex-col outline-none lg:max-h-[85vh] lg:max-w-lg lg:rounded-card lg:shadow-2xl"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div
              className="flex touch-none justify-center pt-2 lg:hidden"
              onPointerDown={(e) => {
                drag.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                e.currentTarget.dataset.y = String(e.clientY);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const start = Number(e.currentTarget.dataset.y || e.clientY);
                const next = Math.max(0, e.clientY - start);
                dyRef.current = next;
                updateDrag(next);
              }}
              onPointerUp={() => {
                drag.current = false;
                if (dyRef.current > 90) close();
                else settleDrag();
                dyRef.current = 0;
              }}
              onPointerCancel={() => {
                drag.current = false;
                dyRef.current = 0;
                settleDrag();
              }}
            >
              <div className="h-1.5 w-9 rounded-pill bg-separator" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2 pt-2">
              <button type="button" onClick={close} className="min-h-11 min-w-11 text-body text-tint">
                {t("cancel")}
              </button>
              <Dialog.Title className="text-headline font-semibold">{title}</Dialog.Title>
              <div className="flex min-w-11 justify-end">{trailing}</div>
            </div>
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
            <div className="sheet-scroll-safe min-h-0 flex-1 overflow-y-auto overscroll-y-contain">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
