// File: src/zai/components/Sheet.tsx
// Accessible modal/sheet primitive: focus trap, Escape, single-main-modal
// enforcement, swipe-to-dismiss on touch, safe-area aware. No window.alert/
// confirm/prompt anywhere in the app — every destructive/blocking UI goes
// through this component.
import { useEffect, useRef, useId, type ReactNode } from "react";
import { create } from "zustand";

interface ModalStackState { stack: string[]; push: (id: string) => void; pop: (id: string) => void; top: () => string | undefined; }
const useModalStack = create<ModalStackState>((set, get) => ({
  stack: [],
  push: (id) => set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })),
  pop: (id) => set((s) => ({ stack: s.stack.filter((x) => x !== id) })),
  top: () => get().stack[get().stack.length - 1],
}));

export type SheetVariant = "center" | "bottom" | "pop";

export function Sheet({
  open, onClose, variant = "center", labelledBy, children, anchorRef, width,
}: {
  open: boolean; onClose: () => void; variant?: SheetVariant;
  labelledBy?: string; children: ReactNode;
  anchorRef?: React.RefObject<HTMLElement | null>; width?: number;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const push = useModalStack((s) => s.push);
  const pop = useModalStack((s) => s.pop);
  const top = useModalStack((s) => s.top);

  useEffect(() => {
    if (!open) return;
    push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevActive = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      node ? Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute("disabled")) : [];
    const first = focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (top() !== id) return; // only the topmost modal responds
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) return;
        const first2 = list[0], last2 = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first2) { e.preventDefault(); last2.focus(); }
        else if (!e.shiftKey && document.activeElement === last2) { e.preventDefault(); first2.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      pop(id);
      prevActive?.focus?.();
    };
  }, [open, id, onClose, push, pop, top]);

  if (!open) return null;

  const onTouchStart = (e: React.TouchEvent) => { if (variant === "bottom") startY.current = e.touches[0].clientY; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (variant !== "bottom" || startY.current == null || !ref.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) ref.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (variant !== "bottom" || startY.current == null || !ref.current) return;
    const dy = e.changedTouches[0].clientY - startY.current;
    ref.current.style.transform = "";
    startY.current = null;
    if (dy > 90) onClose();
  };

  let style: React.CSSProperties = {};
  if (variant === "pop" && anchorRef?.current) {
    const r = anchorRef.current.getBoundingClientRect();
    const w = width ?? 340;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    style = { top: r.bottom + 8, insetInlineStart: left, width: w };
  }

  return (
    <>
      <div className="zai-scrim" onClick={variant === "pop" ? onClose : (e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="zai-scrim" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`zai-sheet ${variant}`}
        style={style}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {variant === "bottom" && <div className="zai-grabber" aria-hidden="true" />}
        {children}
      </div>
    </>
  );
}

export function SheetHeader({ title, onClose, titleId }: { title: string; onClose: () => void; titleId: string }) {
  return (
    <div className="zai-sheet-head">
      <h2 id={titleId}>{title}</h2>
      <button className="zai-icon-btn" aria-label="إغلاق" onClick={onClose}>✕</button>
    </div>
  );
}
