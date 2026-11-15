import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/finance/i18n";
import { prefersReducedMotion } from "./motion-utils";

gsap.registerPlugin(useGSAP);

type SplashScreenProps = {
  onDone: (durationMs: number) => void;
};

export function SplashScreen({ onDone }: SplashScreenProps) {
  const { t, dir } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<SVGGElement>(null);
  const leftPanRef = useRef<SVGPathElement>(null);
  const rightPanRef = useRef<SVGPathElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number>(typeof performance !== "undefined" ? performance.now() : Date.now());
  const finishedRef = useRef(false);
  const [exiting, setExiting] = useState(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    onDone(Math.max(0, Math.round(now - startedAt.current)));
  };

  useEffect(() => {
    // Hard safety timeout so splash never hangs under any browser environment
    const safety = window.setTimeout(() => {
      finish();
    }, 2400);
    return () => window.clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGSAP(
    () => {
      if (!rootRef.current) return;
      if (prefersReducedMotion()) {
        const timer = window.setTimeout(() => {
          setExiting(true);
          finish();
        }, 120);
        return () => window.clearTimeout(timer);
      }

      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => {
          setExiting(true);
          finish();
        },
      });

      if (glowRef.current) {
        tl.fromTo(
          glowRef.current,
          { scale: 0.65, autoAlpha: 0 },
          { scale: 1.08, autoAlpha: 1, duration: 0.45, ease: "power2.out" },
          0,
        );
      }

      if (badgeRef.current) {
        tl.fromTo(
          badgeRef.current,
          { scale: 0.78, y: 14, autoAlpha: 0 },
          { scale: 1, y: 0, autoAlpha: 1, duration: 0.48, ease: "back.out(1.4)" },
          0.04,
        );
      }

      const supportsSvgTransform =
        typeof beamRef.current?.transform?.baseVal?.consolidate === "function";

      if (beamRef.current && supportsSvgTransform) {
        tl.fromTo(
          beamRef.current,
          { rotation: -12, transformOrigin: "16px 14px" },
          {
            keyframes: [
              { rotation: 7, duration: 0.24, ease: "power2.inOut" },
              { rotation: -2.5, duration: 0.18, ease: "power2.inOut" },
              { rotation: 0, duration: 0.22, ease: "power3.out" },
            ],
          },
          0.16,
        );
      } else if (badgeRef.current) {
        tl.to(
          badgeRef.current,
          {
            keyframes: [
              { rotation: -4, duration: 0.2, ease: "power2.inOut" },
              { rotation: 3, duration: 0.2, ease: "power2.inOut" },
              { rotation: 0, duration: 0.2, ease: "power3.out" },
            ],
          },
          0.16,
        );
      }

      if (leftPanRef.current && rightPanRef.current && supportsSvgTransform) {
        tl.fromTo(
          leftPanRef.current,
          { y: -1.4 },
          {
            keyframes: [
              { y: 1.2, duration: 0.24, ease: "power2.inOut" },
              { y: 0, duration: 0.34, ease: "power3.out" },
            ],
          },
          0.16,
        );
        tl.fromTo(
          rightPanRef.current,
          { y: 1.4 },
          {
            keyframes: [
              { y: -1.2, duration: 0.24, ease: "power2.inOut" },
              { y: 0, duration: 0.34, ease: "power3.out" },
            ],
          },
          0.16,
        );
      }

      if (titleRef.current) {
        tl.fromTo(
          titleRef.current,
          { y: 12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.38, ease: "power3.out" },
          0.22,
        );
      }

      if (barRef.current) {
        tl.fromTo(
          barRef.current,
          { scaleX: 0, transformOrigin: dir === "rtl" ? "100% 50%" : "0% 50%" },
          { scaleX: 1, duration: 0.72, ease: "power2.inOut" },
          0.14,
        );
      }

      tl.to(
        rootRef.current,
        {
          autoAlpha: 0,
          scale: 1.025,
          duration: 0.28,
          ease: "power2.in",
        },
        "+=0.14",
      );
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      data-testid="mizan-splash"
      dir={dir}
      role="status"
      aria-label={t("appName")}
      onClick={() => {
        setExiting(true);
        finish();
      }}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-grouped px-6 select-none ${
        exiting ? "pointer-events-none" : ""
      }`}
    >
      <div className="relative flex flex-col items-center">
        <div
          ref={glowRef}
          aria-hidden
          className="pointer-events-none absolute -top-6 h-36 w-36 rounded-full opacity-0 blur-2xl"
          style={{
            background: "radial-gradient(circle, color-mix(in srgb, var(--tint) 36%, transparent) 0%, transparent 72%)",
          }}
        />
        <div
          ref={badgeRef}
          className="glass relative flex h-24 w-24 items-center justify-center rounded-[26px] border border-white/25 shadow-xl"
          style={{
            background: "linear-gradient(155deg, #0a97ff 0%, var(--tint) 58%, #0066cc 100%)",
          }}
        >
          <svg
            viewBox="0 0 32 32"
            className="h-14 w-14 drop-shadow-sm"
            aria-hidden
          >
            <path fill="#fff" d="M15.2 8h1.6v6.2h-1.6z" />
            <circle cx="16" cy="7.2" r="1.5" fill="#fff" />
            <g ref={beamRef}>
              <path fill="#fff" d="M7 13.2h18v1.6H7z" />
              <path
                ref={leftPanRef}
                fill="#fff"
                d="M9.2 14.8h5.2l-.7 6.4c-.1.8-.8 1.4-1.6 1.4h-.6c-.8 0-1.5-.6-1.6-1.4z"
              />
              <path
                ref={rightPanRef}
                fill="#fff"
                d="M17.6 14.8h5.2l-.7 6.4c-.1.8-.8 1.4-1.6 1.4h-.6c-.8 0-1.5-.6-1.6-1.4z"
              />
            </g>
          </svg>
        </div>

        <div ref={titleRef} className="mt-6 text-center">
          <h1 className="text-largetitle font-bold tracking-title text-label">{t("appName")}</h1>
          <p className="mt-1 text-sub text-label-2">{t("appTagline")}</p>
        </div>

        <div className="mt-6 h-1 w-32 overflow-hidden rounded-pill bg-fill">
          <div ref={barRef} className="h-full w-full rounded-pill bg-tint" />
        </div>
      </div>
    </div>
  );
}
