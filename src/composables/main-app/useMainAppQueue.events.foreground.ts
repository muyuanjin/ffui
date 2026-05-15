import type { Ref } from "vue";
import type { TranscodeJob } from "@/types";

interface QueueForegroundRefreshDeps {
  jobs: Ref<TranscodeJob[]>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  refreshQueueFromBackend: () => Promise<void>;
  hasPendingAheadDelta: () => boolean;
  flushPendingQueueState: () => void;
  flushPendingQueueDelta: () => void;
  flushPendingAheadDeltaIfReady: () => void;
  subscribeWindowFocus?: (handler: () => void | Promise<void>) => Promise<() => void>;
  subscribeWindowBlur?: (handler: () => void | Promise<void>) => Promise<() => void>;
  getWindowMinimized?: () => Promise<boolean>;
}

const FOREGROUND_REFRESH_STALE_THRESHOLD_MS = 2_000;
const FOREGROUND_REFRESH_DEBOUNCE_MS = 150;

export function createQueueForegroundRefreshController({
  jobs,
  lastQueueSnapshotAtMs,
  refreshQueueFromBackend,
  hasPendingAheadDelta,
  flushPendingQueueState,
  flushPendingQueueDelta,
  flushPendingAheadDeltaIfReady,
  subscribeWindowFocus,
  subscribeWindowBlur,
  getWindowMinimized,
}: QueueForegroundRefreshDeps) {
  let lastForegroundRefreshAtMs = 0;
  let wasBackgrounded = false;
  let windowMinimized = false;
  let tauriWindowFocusUnlisten: (() => void) | null = null;
  let tauriWindowBlurUnlisten: (() => void) | null = null;
  let mounted = false;
  let subscriptionGeneration = 0;
  let refreshInFlight = false;
  let presenceCheckInFlight: Promise<boolean> | null = null;

  const hasProcessingJobs = () => jobs.value.some((job) => job.status === "processing");

  const markBackgrounded = () => {
    wasBackgrounded = true;
  };

  const isLiveSyncWindow = () => !windowMinimized;

  const refreshQueueOnce = () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    void refreshQueueFromBackend().finally(() => {
      refreshInFlight = false;
    });
  };

  const maybeRefreshQueueOnForeground = (forceRefresh = false) => {
    if (!isLiveSyncWindow()) return;
    const now = Date.now();
    if (lastForegroundRefreshAtMs > 0 && now - lastForegroundRefreshAtMs < FOREGROUND_REFRESH_DEBOUNCE_MS) {
      return;
    }

    const lastSnapshotAt = lastQueueSnapshotAtMs.value;
    const ageMs = typeof lastSnapshotAt === "number" ? Math.max(0, now - lastSnapshotAt) : Number.POSITIVE_INFINITY;
    const resumedFromBackground = wasBackgrounded;
    const shouldRefresh =
      hasPendingAheadDelta() ||
      (hasProcessingJobs() &&
        (forceRefresh || resumedFromBackground || ageMs >= FOREGROUND_REFRESH_STALE_THRESHOLD_MS));
    if (!shouldRefresh) return;

    lastForegroundRefreshAtMs = now;
    refreshQueueOnce();
  };

  const checkWindowMinimized = async () => {
    if (typeof getWindowMinimized !== "function") {
      windowMinimized = false;
      return windowMinimized;
    }

    if (presenceCheckInFlight) return presenceCheckInFlight;

    presenceCheckInFlight = getWindowMinimized()
      .then((minimized) => {
        windowMinimized = minimized;
        return minimized;
      })
      .catch(() => {
        windowMinimized = false;
        return false;
      })
      .finally(() => {
        presenceCheckInFlight = null;
      });

    return presenceCheckInFlight;
  };

  const flushPendingForLiveWindow = () => {
    if (!isLiveSyncWindow()) return;
    flushPendingQueueState();
    flushPendingQueueDelta();
    flushPendingAheadDeltaIfReady();
  };

  const handleForegroundResume = (forceRefresh = false) => {
    const wasLiveSyncWindow = isLiveSyncWindow();
    if (wasLiveSyncWindow) {
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(forceRefresh);
      wasBackgrounded = false;
    }

    void checkWindowMinimized().then((minimized) => {
      if (minimized || !mounted) return;
      if (wasLiveSyncWindow) return;
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(forceRefresh);
      wasBackgrounded = false;
    });
  };

  const requestRefreshForAheadDelta = () => {
    const wasLiveSyncWindow = isLiveSyncWindow();
    if (wasLiveSyncWindow) {
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(true);
    }

    void checkWindowMinimized().then((minimized) => {
      if (minimized || !mounted) return;
      if (wasLiveSyncWindow) return;
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(true);
    });
  };

  const handlePresenceMaybeChanged = (forceRefresh = false) => {
    const wasMinimized = windowMinimized;
    if (isLiveSyncWindow()) {
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(forceRefresh);
    }

    void checkWindowMinimized().then((minimized) => {
      if (minimized || !mounted) return;
      if (!wasMinimized) return;
      flushPendingForLiveWindow();
      maybeRefreshQueueOnForeground(forceRefresh || wasMinimized);
      if (wasMinimized) {
        wasBackgrounded = false;
      }
    });
  };

  const handleVisibleSyncTick = () => {
    void checkWindowMinimized().then((minimized) => {
      if (minimized || !mounted) return;
      flushPendingForLiveWindow();
      if (hasPendingAheadDelta()) {
        maybeRefreshQueueOnForeground(true);
      }
    });
  };

  const handleForegroundResumeSync = () => {
    handleForegroundResume(true);
    wasBackgrounded = false;
  };

  const handleDocumentVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      markBackgrounded();
      void checkWindowMinimized();
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    handleForegroundResumeSync();
  };

  const handleWindowBlur = () => {
    markBackgrounded();
    handlePresenceMaybeChanged(false);
  };

  const handleWindowFocus = () => {
    handleForegroundResumeSync();
  };

  const handleTauriWindowFocus = () => {
    wasBackgrounded = true;
    handleForegroundResumeSync();
  };

  const handleTauriWindowBlur = () => {
    markBackgrounded();
    handlePresenceMaybeChanged(false);
  };

  const isActiveSubscription = (generation: number) => mounted && generation === subscriptionGeneration;

  const storeTauriWindowFocusUnlisten = (generation: number, unlisten: (() => void) | null | undefined) => {
    const nextUnlisten = typeof unlisten === "function" ? unlisten : null;
    if (!nextUnlisten) {
      return;
    }
    if (!isActiveSubscription(generation)) {
      nextUnlisten();
      return;
    }
    tauriWindowFocusUnlisten = nextUnlisten;
  };

  const storeTauriWindowBlurUnlisten = (generation: number, unlisten: (() => void) | null | undefined) => {
    const nextUnlisten = typeof unlisten === "function" ? unlisten : null;
    if (!nextUnlisten) {
      return;
    }
    if (!isActiveSubscription(generation)) {
      nextUnlisten();
      return;
    }
    tauriWindowBlurUnlisten = nextUnlisten;
  };

  const logTauriWindowSubscriptionFailure = (eventName: "focus" | "blur", err: unknown) => {
    console.error(`Failed to register queue window ${eventName} listener:`, err);
  };

  const mount = () => {
    mounted = true;
    subscriptionGeneration += 1;
    const generation = subscriptionGeneration;

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleDocumentVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("focus", handleWindowFocus);
    }
    if (typeof subscribeWindowFocus === "function") {
      void subscribeWindowFocus(() => {
        if (!isActiveSubscription(generation)) return;
        handleTauriWindowFocus();
      })
        .then((unlisten) => storeTauriWindowFocusUnlisten(generation, unlisten))
        .catch((err) => {
          logTauriWindowSubscriptionFailure("focus", err);
        });
    }
    if (typeof subscribeWindowBlur === "function") {
      void subscribeWindowBlur(() => {
        if (!isActiveSubscription(generation)) return;
        handleTauriWindowBlur();
      })
        .then((unlisten) => storeTauriWindowBlurUnlisten(generation, unlisten))
        .catch((err) => {
          logTauriWindowSubscriptionFailure("blur", err);
        });
    }
    void checkWindowMinimized();
  };

  const unmount = () => {
    mounted = false;
    subscriptionGeneration += 1;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleDocumentVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    }
    if (tauriWindowFocusUnlisten) {
      try {
        tauriWindowFocusUnlisten();
      } finally {
        tauriWindowFocusUnlisten = null;
      }
    }
    if (tauriWindowBlurUnlisten) {
      try {
        tauriWindowBlurUnlisten();
      } finally {
        tauriWindowBlurUnlisten = null;
      }
    }
  };

  return { mount, unmount, requestRefreshForAheadDelta, handleVisibleSyncTick };
}
