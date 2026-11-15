export const PERF_METRICS_STORAGE_KEY = "mizan.perf.v1";

export type BootPerfSample = {
  recordedAt: number;
  domContentLoadedMs: number;
  firstInteractiveMs: number;
  splashMs?: number;
};

const MAX_SAMPLES = 20;
let bootStartStamp = typeof performance !== "undefined" ? performance.now() : 0;

export function markBootStart(): void {
  if (typeof performance !== "undefined") {
    bootStartStamp = performance.now();
  }
}

export function loadPerfMetrics(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): BootPerfSample[] {
  try {
    const raw = storage?.getItem(PERF_METRICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BootPerfSample[]) : [];
  } catch {
    return [];
  }
}

export function recordBootMetrics(
  splashMs?: number,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): BootPerfSample {
  let domContentLoadedMs = 0;
  let firstInteractiveMs = 0;

  if (typeof performance !== "undefined") {
    const navEntries =
      typeof performance.getEntriesByType === "function"
        ? (performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
        : [];
    const nav = navEntries[0];
    if (nav) {
      domContentLoadedMs = Math.max(0, Math.round(nav.domContentLoadedEventEnd - nav.startTime));
      firstInteractiveMs = Math.max(0, Math.round(performance.now() - nav.startTime));
    } else {
      firstInteractiveMs = Math.max(0, Math.round(performance.now() - bootStartStamp));
      domContentLoadedMs = firstInteractiveMs;
    }
  }

  const sample: BootPerfSample = {
    recordedAt: Date.now(),
    domContentLoadedMs,
    firstInteractiveMs,
    splashMs: typeof splashMs === "number" ? Math.max(0, Math.round(splashMs)) : undefined,
  };

  try {
    const prev = loadPerfMetrics(storage);
    const next = [sample, ...prev].slice(0, MAX_SAMPLES);
    storage?.setItem(PERF_METRICS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage errors */
  }
  return sample;
}

export function getLatestPerfSample(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): BootPerfSample | null {
  return loadPerfMetrics(storage)[0] ?? null;
}

export function clearPerfMetrics(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  try {
    storage?.removeItem(PERF_METRICS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
