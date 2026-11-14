import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, type ReactNode } from "react";

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
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        gsap.set(root.current, { clearProps: "all" });
        return;
      }
      gsap.fromTo(
        root.current,
        { autoAlpha: 0, y: 10, scale: 0.995 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: "power3.out", overwrite: "auto" },
      );
    },
    { scope: root, dependencies: [motionKey], revertOnUpdate: true },
  );

  return (
    <div ref={root} className="screen-content min-w-0">
      {children}
    </div>
  );
}
