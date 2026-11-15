import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "./motion-utils";

gsap.registerPlugin(useGSAP);

type MotionScreenProps = {
  children: ReactNode;
  motionKey: string;
};

export function MotionScreen({ children, motionKey }: MotionScreenProps) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!root.current) return;
      if (prefersReducedMotion()) {
        gsap.set(root.current, { clearProps: "all" });
        return;
      }
      const sections = root.current.querySelectorAll<HTMLElement>("[data-stagger]");
      const tl = gsap.timeline({ defaults: { ease: "power3.out", overwrite: "auto" } });
      tl.fromTo(
        root.current,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.34, clearProps: "transform,opacity" },
      );
      if (sections.length > 0) {
        tl.fromTo(
          sections,
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.34,
            stagger: 0.035,
            clearProps: "transform,opacity",
          },
          0.04,
        );
      }
    },
    { scope: root, dependencies: [motionKey], revertOnUpdate: true },
  );

  return (
    <div ref={root} className="screen-content min-w-0">
      {children}
    </div>
  );
}

export function AnimatedBar({
  pct,
  colorClass,
  trackClass = "bg-fill",
  heightClass = "h-1.5",
}: {
  pct: number;
  colorClass: string;
  trackClass?: string;
  heightClass?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const clamped = Math.max(0, Math.min(100, pct));

  useGSAP(
    () => {
      if (!bar.current) return;
      if (prefersReducedMotion()) {
        gsap.set(bar.current, { width: `${clamped}%` });
        return;
      }
      gsap.fromTo(
        bar.current,
        { width: "0%" },
        { width: `${clamped}%`, duration: 0.55, ease: "power3.out", overwrite: "auto" },
      );
    },
    { scope: bar, dependencies: [clamped] },
  );

  return (
    <div className={cn("overflow-hidden rounded-pill", trackClass, heightClass)}>
      <div
        ref={bar}
        className={cn("h-full rounded-pill", colorClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
