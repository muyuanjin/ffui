const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 250;

export function clampProgressUpdateIntervalMs(value: unknown, fallback = DEFAULT_PROGRESS_UPDATE_INTERVAL_MS): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.max(value, 50), 2000);
  }
  return fallback;
}

export function deriveProgressTransitionMs(updateIntervalMs: number): number {
  const interval = clampProgressUpdateIntervalMs(updateIntervalMs);
  if (interval <= 50) return 0;
  if (interval <= 100) return 80;
  if (interval <= 200) return 120;
  return Math.min(Math.max(Math.floor(interval * 0.6), 150), 300);
}
