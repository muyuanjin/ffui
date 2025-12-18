export type ScrubFrameQuality = "low" | "high";
export type ScrubFrameLowMode = "debounce" | "throttle";

export type ScrubFrameSchedulerRequestFn = (quality: ScrubFrameQuality, token: number) => Promise<void>;

export interface ScrubFrameScheduler {
  scheduleLow: (key: string) => void;
  scheduleHighDebounced: (key: string) => void;
  requestHighNow: (key: string) => void;
  clearTimers: () => void;
  cancel: () => void;
  isTokenCurrent: (token: number) => boolean;
  getToken: () => number;
}

export const createScrubFrameScheduler = (options: {
  lowDelayMs?: number;
  lowMode?: ScrubFrameLowMode;
  highDelayMs?: number;
  request: ScrubFrameSchedulerRequestFn;
}): ScrubFrameScheduler => {
  const lowDelayMs = Number.isFinite(options.lowDelayMs) ? Math.max(0, options.lowDelayMs ?? 0) : 120;
  const lowMode: ScrubFrameLowMode = options.lowMode ?? "debounce";
  const highDelayMs = Number.isFinite(options.highDelayMs) ? Math.max(0, options.highDelayMs ?? 0) : 240;

  let token = 0;
  let key: string | null = null;

  let inflight = false;
  let pending: { quality: ScrubFrameQuality; token: number } | null = null;

  let lowTimer: ReturnType<typeof setTimeout> | null = null;
  let highTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledLowToken = 0;
  let scheduledHighToken = 0;
  let lastLowScheduledAtMs = 0;

  const clearTimers = () => {
    if (lowTimer != null) {
      clearTimeout(lowTimer);
      lowTimer = null;
    }
    if (highTimer != null) {
      clearTimeout(highTimer);
      highTimer = null;
    }
  };

  const bumpTokenIfKeyChanged = (nextKey: string) => {
    if (nextKey !== key) {
      key = nextKey;
      token += 1;
    }
    return token;
  };

  const isTokenCurrent = (candidate: number) => candidate === token;

  const setPending = (quality: ScrubFrameQuality, requestToken: number) => {
    if (!pending) {
      pending = { quality, token: requestToken };
      return;
    }

    if (requestToken > pending.token) {
      pending = { quality, token: requestToken };
      return;
    }

    if (requestToken < pending.token) return;

    if (pending.quality === "high") return;
    if (quality === "high") pending.quality = "high";
  };

  const runRequest = async (quality: ScrubFrameQuality, requestToken: number) => {
    if (!isTokenCurrent(requestToken)) return;
    inflight = true;
    try {
      await options.request(quality, requestToken);
    } finally {
      inflight = false;
    }

    const next = pending;
    pending = null;
    if (next) {
      void startOrQueue(next.quality, next.token);
    }
  };

  const startOrQueue = async (quality: ScrubFrameQuality, requestToken: number) => {
    if (!isTokenCurrent(requestToken)) return;
    if (inflight) {
      setPending(quality, requestToken);
      return;
    }
    await runRequest(quality, requestToken);
  };

  const scheduleLow = (nextKey: string) => {
    const requestToken = bumpTokenIfKeyChanged(nextKey);

    scheduledLowToken = requestToken;

    if (lowMode === "debounce") {
      if (lowTimer != null) clearTimeout(lowTimer);
      lowTimer = setTimeout(() => {
        lowTimer = null;
        void startOrQueue("low", scheduledLowToken);
      }, lowDelayMs);
      return;
    }

    if (lowTimer != null) return;

    const now = Date.now();
    const elapsed = now - lastLowScheduledAtMs;
    const delay = elapsed >= lowDelayMs ? 0 : lowDelayMs - elapsed;
    lowTimer = setTimeout(() => {
      lowTimer = null;
      lastLowScheduledAtMs = Date.now();
      void startOrQueue("low", scheduledLowToken);
    }, delay);
  };

  const scheduleHighDebounced = (nextKey: string) => {
    const requestToken = bumpTokenIfKeyChanged(nextKey);
    scheduledHighToken = requestToken;

    if (highTimer != null) {
      clearTimeout(highTimer);
      highTimer = null;
    }
    highTimer = setTimeout(() => {
      highTimer = null;
      void startOrQueue("high", scheduledHighToken);
    }, highDelayMs);
  };

  const requestHighNow = (nextKey: string) => {
    const requestToken = bumpTokenIfKeyChanged(nextKey);

    if (highTimer != null) {
      clearTimeout(highTimer);
      highTimer = null;
    }

    void startOrQueue("high", requestToken);
  };

  const cancel = () => {
    token += 1;
    key = null;
    pending = null;
    clearTimers();
  };

  const getToken = () => token;

  return {
    scheduleLow,
    scheduleHighDebounced,
    requestHighNow,
    clearTimers,
    cancel,
    isTokenCurrent,
    getToken,
  };
};
