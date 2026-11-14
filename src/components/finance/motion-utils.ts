import gsap from "gsap";
import { useCallback, useRef } from "react";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function usePinShake() {
  const ref = useRef<HTMLDivElement>(null);

  const triggerShake = useCallback(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    gsap.fromTo(
      el,
      { x: 0 },
      {
        keyframes: [
          { x: -10, duration: 0.06 },
          { x: 10, duration: 0.06 },
          { x: -7, duration: 0.06 },
          { x: 7, duration: 0.06 },
          { x: -3, duration: 0.05 },
          { x: 0, duration: 0.05 },
        ],
        ease: "power2.out",
        overwrite: "auto",
      },
    );
  }, []);

  return { ref, triggerShake };
}
