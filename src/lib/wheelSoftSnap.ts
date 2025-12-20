type TimerHandle = ReturnType<typeof setTimeout>;

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const getDirection = (deltaPx: number): -1 | 1 | 0 => {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return 0;
  return deltaPx > 0 ? 1 : -1;
};

const pickDominantAxisDelta = (event: WheelEvent): number => {
  const dx = Number(event.deltaX);
  const dy = Number(event.deltaY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  return Math.abs(dy) >= Math.abs(dx) ? dy : dx;
};

export const normalizeWheelDeltaPixels = (
  event: WheelEvent,
  params: { pageSizePx?: number; lineHeightPx?: number } = {},
): number => {
  const raw = pickDominantAxisDelta(event);
  if (!raw) return 0;

  const mode = Number(event.deltaMode);
  if (mode === 0) return raw; // DOM_DELTA_PIXEL
  if (mode === 1) {
    const lineHeightPx = Number.isFinite(params.lineHeightPx ?? NaN) ? (params.lineHeightPx as number) : 16;
    return raw * lineHeightPx;
  }
  if (mode === 2) {
    const pageSizePx = Number.isFinite(params.pageSizePx ?? NaN) ? (params.pageSizePx as number) : 800;
    return raw * pageSizePx;
  }
  return raw;
};

export type WheelSoftSnapController = Readonly<{
  onWheel: (
    event: WheelEvent,
    params: {
      onStep: (direction: -1 | 1) => boolean;
      shouldConsume?: (direction: -1 | 1) => boolean;
    },
  ) => void;
  reset: () => void;
}>;

export const createWheelSoftSnapController = (params: {
  getThresholdPx: () => number;
  getPageSizePx?: () => number;
  minIntervalMs?: number;
  gestureResetMs?: number;
  maxAccumulatedPx?: number;
}): WheelSoftSnapController => {
  const minIntervalMs = params.minIntervalMs ?? 40;
  const gestureResetMs = params.gestureResetMs ?? 140;
  const maxAccumulatedPx = params.maxAccumulatedPx ?? 600;

  let accumulatedPx = 0;
  let resetTimer: TimerHandle | null = null;
  let lastDirection: -1 | 1 | 0 = 0;
  let lastStepAtMs = 0;

  const clearResetTimer = () => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  const reset = () => {
    accumulatedPx = 0;
    lastDirection = 0;
    lastStepAtMs = 0;
    clearResetTimer();
  };

  const scheduleGestureReset = () => {
    clearResetTimer();
    resetTimer = setTimeout(() => {
      resetTimer = null;
      accumulatedPx = 0;
      lastDirection = 0;
    }, gestureResetMs);
  };

  const onWheel = (
    event: WheelEvent,
    {
      onStep,
      shouldConsume,
    }: { onStep: (direction: -1 | 1) => boolean; shouldConsume?: (direction: -1 | 1) => boolean },
  ) => {
    if (event.defaultPrevented) return;
    // On macOS trackpads, pinch-to-zoom often appears as Ctrl+wheel; avoid hijacking it.
    if (event.ctrlKey) return;

    const pageSizePx = params.getPageSizePx?.();
    const deltaPx = normalizeWheelDeltaPixels(event, { pageSizePx });
    if (!deltaPx || !Number.isFinite(deltaPx)) return;

    scheduleGestureReset();

    const direction = getDirection(deltaPx);
    if (direction === 0) return;

    const threshold = Math.max(1, Number(params.getThresholdPx()));
    if (!Number.isFinite(threshold)) return;

    if (lastDirection !== 0 && direction !== lastDirection) {
      accumulatedPx = 0;
    }
    lastDirection = direction;

    if (shouldConsume?.(direction) === true && event.cancelable) {
      event.preventDefault();
    }

    accumulatedPx = clampNumber(accumulatedPx + deltaPx, -maxAccumulatedPx, maxAccumulatedPx);
    if (Math.abs(accumulatedPx) < threshold) return;

    const now = Date.now();
    if (minIntervalMs > 0 && now - lastStepAtMs < minIntervalMs) return;

    const didStep = onStep(direction);
    if (!didStep) return;

    if (event.cancelable) event.preventDefault();
    accumulatedPx -= direction * threshold;
    lastStepAtMs = now;
  };

  return {
    onWheel,
    reset,
  };
};
