import * as Dialog from "@radix-ui/react-dialog";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/finance/logic";
import type { Currency } from "@/lib/finance/types";

gsap.registerPlugin(useGSAP);

export function Amount({
  value,
  currency,
  sign = "none",
  className,
}: {
  value: number;
  currency: Currency;
  sign?: "auto" | "plus" | "minus" | "none";
  className?: string;
}) {
  const neg = sign === "minus" || (sign === "auto" && value < 0);
  const pos = sign === "plus" || (sign === "auto" && value > 0);
  const tone = neg ? "text-expense" : pos ? "text-income" : "text-label";
  return (
    <span dir="ltr" className={cn("num whitespace-nowrap", tone, className)}>
      {neg ? "−" : pos ? "+" : ""}
      {money(value, currency)}
    </span>
  );
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
  const section = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!section.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(section.current, { autoAlpha: 0, y: 8 }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.28,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "opacity,visibility,transform",
    });
  }, { scope: section });

  return (
    <section ref={section} className={cn("mt-6", className)}>
      {title ? <h2 className="px-8 pb-2 text-foot text-label-2">{title}</h2> : null}
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
  const group = useRef<HTMLDivElement>(null);
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);

  useGSAP(() => {
    if (!group.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(Array.from(group.current.children), { autoAlpha: 0, y: 5 }, {
      autoAlpha: 1,
      y: 0,
      duration: 0.22,
      stagger: { each: 0.025, amount: 0.18 },
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "opacity,visibility,transform",
    });
  }, { scope: group });

  return (
    <div ref={group} className="mx-4 overflow-hidden rounded-cell bg-cell">
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
  title: string;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-start">
        <span className={cn("block truncate text-body", destructive && "text-expense")}>{title}</span>
        {sub ? <span className="block truncate text-foot text-label-2">{sub}</span> : null}
      </span>
      {trailing ? <span className="flex min-w-0 max-w-[48%] shrink-0 items-center justify-end gap-1 overflow-hidden">{trailing}</span> : null}
      {chevron ? <ChevronLeft className="shrink-0 text-label-3" size={18} strokeWidth={2} aria-hidden /> : null}
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
    <div className="px-8 py-14 text-center">
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
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "tint" | "gray" | "plain" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const tones = {
    tint: "bg-tint text-on-tint",
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
  return (
    <div
      className={cn("grid rounded-cell bg-fill p-0.5", segmentCols[options.length] ?? "grid-cols-2")}
      role="tablist"
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "min-h-11 rounded-lg px-2 text-sub font-semibold",
              on ? "bg-cell text-label shadow-sm" : "text-label-2",
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
        className="field rounded-cell bg-fill px-3"
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
  const [shown, setShown] = useState(false);
  const drag = useRef(false);
  const dyRef = useRef(0);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { contextSafe } = useGSAP(
    () => {
      if (!panel.current || !shown) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        gsap.set(panel.current, { y: 0 });
        return;
      }
      gsap.fromTo(panel.current, { yPercent: 100 }, { yPercent: 0, duration: 0.42, ease: "power3.out", overwrite: "auto" });
    },
    { scope: panel, dependencies: [shown], revertOnUpdate: true },
  );

  const close = contextSafe(() => {
    if (!panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    gsap.to(panel.current, { yPercent: 100, duration: 0.28, ease: "power2.in", overwrite: "auto", onComplete: onClose });
  });

  const updateDrag = contextSafe((next: number) => {
    if (panel.current) gsap.set(panel.current, { y: next });
  });

  const settleDrag = contextSafe(() => {
    if (panel.current) gsap.to(panel.current, { y: 0, duration: 0.42, ease: "power3.out", overwrite: "auto" });
  });

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="absolute inset-0 z-40 bg-black/40" />
          <Dialog.Content
          ref={panel}
          className="sheet-panel absolute inset-x-0 bottom-0 z-50 flex flex-col outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="flex touch-none justify-center pt-2"
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
          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <button type="button" onClick={close} className="min-h-11 min-w-11 text-body text-tint">
              إلغاء
            </button>
            <Dialog.Title className="text-headline font-semibold">{title}</Dialog.Title>
            <div className="flex min-w-11 justify-end">{trailing}</div>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto pb-8">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
