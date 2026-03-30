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
}

const FOREGROUND_REFRESH_STALE_THRESHOLD_MS = 2_000;
const FOREGROUND_REFRESH_MIN_INTERVAL_MS = 2_000;

export function createQueueForegroundRefreshController({
  jobs,
  lastQueueSnapshotAtMs,
  refreshQueueFromBackend,
  hasPendingAheadDelta,
  flushPendingQueueState,
  flushPendingQueueDelta,
  flushPendingAheadDeltaIfReady,
}: QueueForegroundRefreshDeps) {
  let lastForegroundRefreshAtMs = 0;

  const hasProcessingJobs = () => jobs.value.some((job) => job.status === "processing");

  const maybeRefreshQueueOnForeground = () => {
    const now = Date.now();
    if (lastForegroundRefreshAtMs > 0 && now - lastForegroundRefreshAtMs < FOREGROUND_REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    const lastSnapshotAt = lastQueueSnapshotAtMs.value;
    const ageMs = typeof lastSnapshotAt === "number" ? Math.max(0, now - lastSnapshotAt) : Number.POSITIVE_INFINITY;
    const shouldRefresh =
      hasPendingAheadDelta() || (hasProcessingJobs() && ageMs >= FOREGROUND_REFRESH_STALE_THRESHOLD_MS);
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
  };

  const handleDocumentVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    handleForegroundResume();
  };

  const handleWindowFocus = () => {
    handleForegroundResume();
  };

  const mount = () => {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleDocumentVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleWindowFocus);
    }
  };

  const unmount = () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleDocumentVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleWindowFocus);
    }
  };

  return { mount, unmount };
}
