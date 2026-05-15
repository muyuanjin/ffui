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
}: QueueForegroundRefreshDeps) {
  let lastForegroundRefreshAtMs = 0;
  let wasBackgrounded = false;
  let tauriWindowFocusUnlisten: (() => void) | null = null;
  let tauriWindowBlurUnlisten: (() => void) | null = null;
  let mounted = false;
  let subscriptionGeneration = 0;

  const hasProcessingJobs = () => jobs.value.some((job) => job.status === "processing");

  const markBackgrounded = () => {
    wasBackgrounded = true;
  };

  const maybeRefreshQueueOnForeground = () => {
    const now = Date.now();
    if (lastForegroundRefreshAtMs > 0 && now - lastForegroundRefreshAtMs < FOREGROUND_REFRESH_DEBOUNCE_MS) {
      return;
    }

    const lastSnapshotAt = lastQueueSnapshotAtMs.value;
    const ageMs = typeof lastSnapshotAt === "number" ? Math.max(0, now - lastSnapshotAt) : Number.POSITIVE_INFINITY;
    const resumedFromBackground = wasBackgrounded;
    const shouldRefresh =
      hasPendingAheadDelta() ||
      (hasProcessingJobs() && (resumedFromBackground || ageMs >= FOREGROUND_REFRESH_STALE_THRESHOLD_MS));
    if (!shouldRefresh) return;

    lastForegroundRefreshAtMs = now;
    void refreshQueueFromBackend();
  };

  const handleForegroundResume = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    flushPendingQueueState();
    flushPendingQueueDelta();
    flushPendingAheadDeltaIfReady();
    maybeRefreshQueueOnForeground();
    wasBackgrounded = false;
  };

  const handleDocumentVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      markBackgrounded();
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    handleForegroundResume();
  };

  const handleWindowBlur = () => {
    markBackgrounded();
  };

  const handleWindowFocus = () => {
    handleForegroundResume();
  };

  const handleTauriWindowFocus = () => {
    wasBackgrounded = true;
    handleForegroundResume();
  };

  const handleTauriWindowBlur = () => {
    markBackgrounded();
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

  return { mount, unmount };
}
