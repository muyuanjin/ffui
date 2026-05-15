import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { hasTauri } from "@/lib/backend";
import type { QueueStateLite, QueueStateLiteDelta, TranscodeJob } from "@/types";
import { recordQueueEvent } from "@/lib/queuePerf";
import { subscribeTauriEvent, type UnsubscribeFn } from "@/lib/tauriSubscriptions";
import { getAcceptedDeltaRevisionForJobs } from "@/composables/queue/operations-state-sync";
import { coalesceQueueDeltaFrames, type QueueDeltaFrame } from "./useMainAppQueue.events.delta";
import { createQueueForegroundRefreshController } from "./useMainAppQueue.events.foreground";

interface QueueEventDeps {
  jobs: Ref<TranscodeJob[]>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  lastQueueSnapshotRevision: Ref<number | null>;
  startupIdleReady?: Ref<boolean>;
  refreshQueueFromBackend: () => Promise<void>;
  applyQueueStateFromBackend: (state: QueueStateLite) => void;
  applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) => void;
}

/**
 * Wire up Tauri queue events and periodic safety polls for MainApp's queue.
 * Extracted to keep the main composable focused on state wiring while
 * preserving existing behaviour.
 */
export function useQueueEventListeners({
  jobs,
  lastQueueSnapshotAtMs,
  lastQueueSnapshotRevision,
  startupIdleReady,
  refreshQueueFromBackend,
  applyQueueStateFromBackend,
  applyQueueStateLiteDeltaFromBackend,
}: QueueEventDeps): void {
  let unsubscribeQueueSnapshot: UnsubscribeFn | null = null;
  let unsubscribeQueueDelta: UnsubscribeFn | null = null;
  let disposed = false;
  let queueTimer: number | undefined;
  let initialQueuePollScheduled = false;
  let initialQueuePollCancelled = false;
  let pendingQueueState: QueueStateLite | null = null;
  let pendingApplyHandle: number | null = null;
  let pendingApplyDeadlineHandle: number | null = null;
  let pendingDeltaBaseRevision: number | null = null;
  let pendingDeltaFrames: QueueDeltaFrame[] | null = null;
  let pendingDeltaApplyHandle: number | null = null;
  let pendingDeltaApplyDeadlineHandle: number | null = null;
  let pendingAheadDeltaBaseRevision: number | null = null;
  let pendingAheadDeltaFrames: QueueDeltaFrame[] | null = null;
  let pendingAheadRefreshHandle: number | null = null;
  let lastAheadRefreshAtMs = 0;

  const AHEAD_REFRESH_DELAY_MS = 5_000;
  const AHEAD_REFRESH_MIN_INTERVAL_MS = 30_000;
  // `requestAnimationFrame` can be throttled heavily when the window is
  // backgrounded. Keep a hard upper bound on UI staleness by adding a
  // timeout fallback for queue event flushes.
  const UI_FLUSH_DEADLINE_MS = 100;

  const getDeltaRevisionFloor = (baseSnapshotRevision: number): number => {
    const acceptedRevision = getAcceptedDeltaRevisionForJobs(jobs, baseSnapshotRevision);
    return typeof acceptedRevision === "number" && Number.isFinite(acceptedRevision) ? acceptedRevision : -1;
  };

  const flushPendingQueueState = () => {
    if (pendingApplyHandle != null && typeof window !== "undefined") {
      if (typeof window.cancelAnimationFrame === "function") {
        try {
          window.cancelAnimationFrame(pendingApplyHandle);
        } catch {
          // ignore
        }
      }
      window.clearTimeout(pendingApplyHandle);
    }
    pendingApplyHandle = null;

    if (pendingApplyDeadlineHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingApplyDeadlineHandle);
    }
    pendingApplyDeadlineHandle = null;

    const next = pendingQueueState;
    pendingQueueState = null;
    if (next) applyQueueStateFromBackend(next);
    flushPendingAheadDeltaIfReady();
  };

  const flushPendingQueueDelta = () => {
    if (pendingDeltaApplyHandle != null && typeof window !== "undefined") {
      if (typeof window.cancelAnimationFrame === "function") {
        try {
          window.cancelAnimationFrame(pendingDeltaApplyHandle);
        } catch {
          // ignore
        }
      }
      window.clearTimeout(pendingDeltaApplyHandle);
    }
    pendingDeltaApplyHandle = null;

    if (pendingDeltaApplyDeadlineHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingDeltaApplyDeadlineHandle);
    }
    pendingDeltaApplyDeadlineHandle = null;

    if (!pendingDeltaFrames || pendingDeltaBaseRevision == null) return;

    const deltaBaseRevision = pendingDeltaBaseRevision;
    const { deltaRevision, patches } = coalesceQueueDeltaFrames(
      pendingDeltaFrames,
      getDeltaRevisionFloor(deltaBaseRevision),
    );
    pendingDeltaFrames = null;
    pendingDeltaBaseRevision = null;
    if (deltaRevision == null) return;

    const delta: QueueStateLiteDelta = {
      baseSnapshotRevision: deltaBaseRevision,
      deltaRevision,
      patches,
    };

    applyQueueStateLiteDeltaFromBackend(delta);
  };

  const scheduleInitialQueuePoll = () => {
    if (initialQueuePollScheduled) return;
    initialQueuePollScheduled = true;

    const runInitialPoll = async () => {
      if (initialQueuePollCancelled) return;
      await refreshQueueFromBackend();
    };

    // When no idle gate is provided, preserve the previous behaviour and run
    // the initial poll immediately on mount.
    if (!startupIdleReady) {
      void runInitialPoll();
      return;
    }

    // If the gate is already open, run the poll right away.
    if (startupIdleReady.value) {
      void runInitialPoll();
      return;
    }

    // Otherwise wait for the idle gate to open, then perform a single poll.
    const stop = watch(
      startupIdleReady,
      (ready) => {
        if (!ready || initialQueuePollCancelled) return;
        stop();
        void runInitialPoll();
      },
      { flush: "post" },
    );
  };

  const scheduleAheadRefresh = () => {
    if (pendingAheadRefreshHandle != null) return;
    const now = Date.now();
    if (lastAheadRefreshAtMs > 0 && now - lastAheadRefreshAtMs < AHEAD_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    if (typeof window === "undefined") {
      void refreshQueueFromBackend();
      return;
    }
    pendingAheadRefreshHandle = window.setTimeout(() => {
      pendingAheadRefreshHandle = null;
      const now = Date.now();
      if (lastAheadRefreshAtMs > 0 && now - lastAheadRefreshAtMs < AHEAD_REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      const base = pendingAheadDeltaBaseRevision;
      if (base == null) return;

      const currentSnapshotRevision = lastQueueSnapshotRevision.value;
      if (
        typeof currentSnapshotRevision === "number" &&
        Number.isFinite(currentSnapshotRevision) &&
        base <= currentSnapshotRevision
      ) {
        return;
      }
      lastAheadRefreshAtMs = now;
      void refreshQueueFromBackend();
    }, AHEAD_REFRESH_DELAY_MS);
  };

  const flushPendingAheadDeltaIfReady = () => {
    const base = pendingAheadDeltaBaseRevision;
    const frames = pendingAheadDeltaFrames;
    if (base == null || !frames) return;

    const currentSnapshotRevision = lastQueueSnapshotRevision.value;
    if (typeof currentSnapshotRevision !== "number" || !Number.isFinite(currentSnapshotRevision)) return;

    if (base < currentSnapshotRevision) {
      pendingAheadDeltaBaseRevision = null;
      pendingAheadDeltaFrames = null;
      return;
    }

    if (base !== currentSnapshotRevision) return;

    const { deltaRevision, patches } = coalesceQueueDeltaFrames(frames, getDeltaRevisionFloor(base));

    pendingAheadDeltaBaseRevision = null;
    pendingAheadDeltaFrames = null;
    if (deltaRevision == null) return;

    const delta: QueueStateLiteDelta = {
      baseSnapshotRevision: base,
      deltaRevision,
      patches,
    };

    applyQueueStateLiteDeltaFromBackend(delta);
  };

  const hasPendingAheadDelta = () => {
    return pendingAheadDeltaBaseRevision != null && pendingAheadDeltaFrames != null;
  };
  const foregroundRefreshController = createQueueForegroundRefreshController({
    jobs,
    lastQueueSnapshotAtMs,
    refreshQueueFromBackend,
    hasPendingAheadDelta,
    flushPendingQueueState,
    flushPendingQueueDelta,
    flushPendingAheadDeltaIfReady,
    subscribeWindowFocus: hasTauri()
      ? async (handler) => subscribeTauriEvent("tauri://focus", async () => handler(), { key: "queue-window-focus" })
      : undefined,
    subscribeWindowBlur: hasTauri()
      ? async (handler) => subscribeTauriEvent("tauri://blur", async () => handler(), { key: "queue-window-blur" })
      : undefined,
  });

  watch(
    lastQueueSnapshotRevision,
    () => {
      flushPendingAheadDeltaIfReady();
    },
    { flush: "post" },
  );

  onMounted(() => {
    if (!hasTauri()) {
      return;
    }

    foregroundRefreshController.mount();

    void subscribeTauriEvent<QueueStateLite>(
      "ffui://queue-state-lite",
      (payload) => {
        recordQueueEvent("snapshot", payload);
        const revision = payload?.snapshotRevision;
        const currentRevision = lastQueueSnapshotRevision.value;
        if (
          typeof revision === "number" &&
          Number.isFinite(revision) &&
          typeof currentRevision === "number" &&
          Number.isFinite(currentRevision) &&
          revision < currentRevision
        ) {
          return;
        }

        if (pendingQueueState) {
          const prev = pendingQueueState.snapshotRevision;
          if (
            typeof revision === "number" &&
            Number.isFinite(revision) &&
            typeof prev === "number" &&
            Number.isFinite(prev)
          ) {
            if (revision >= prev) {
              pendingQueueState = payload;
            }
          } else {
            pendingQueueState = payload;
          }
        } else {
          pendingQueueState = payload;
        }

        if (typeof window === "undefined") {
          flushPendingQueueState();
        } else if (pendingApplyHandle == null && pendingApplyDeadlineHandle == null) {
          if (typeof window.requestAnimationFrame === "function") {
            pendingApplyHandle = window.requestAnimationFrame(flushPendingQueueState);
            pendingApplyDeadlineHandle = window.setTimeout(() => {
              pendingApplyDeadlineHandle = null;
              flushPendingQueueState();
            }, UI_FLUSH_DEADLINE_MS);
          } else {
            pendingApplyHandle = window.setTimeout(flushPendingQueueState, 0);
          }
        }
        // Any push-style queue event cancels the deferred initial poll so we
        // avoid issuing a redundant full snapshot request on startup.
        initialQueuePollCancelled = true;
      },
      { debugLabel: "ffui://queue-state-lite" },
    )
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        unsubscribeQueueSnapshot = unsubscribe;
      })
      .catch((err) => {
        console.error("Failed to register queue_state listener:", err);
      });

    void subscribeTauriEvent<QueueStateLiteDelta>(
      "ffui://queue-state-lite-delta",
      (payload) => {
        recordQueueEvent("delta", payload, payload?.patches?.length ?? 0);
        const base = payload?.baseSnapshotRevision;
        const rev = payload?.deltaRevision;

        if (typeof base !== "number" || !Number.isFinite(base)) return;
        if (typeof rev !== "number" || !Number.isFinite(rev)) return;

        const currentSnapshotRevision = lastQueueSnapshotRevision.value;
        const hasCurrentRevision =
          typeof currentSnapshotRevision === "number" && Number.isFinite(currentSnapshotRevision);
        if (hasCurrentRevision && base < currentSnapshotRevision) {
          return;
        }
        if (!hasCurrentRevision || base > currentSnapshotRevision) {
          if (pendingAheadDeltaBaseRevision !== base) {
            pendingAheadDeltaBaseRevision = base;
            pendingAheadDeltaFrames = [];
          }
          if (pendingAheadDeltaFrames) {
            pendingAheadDeltaFrames.push({ rev, patches: payload?.patches });
          }

          scheduleAheadRefresh();
          return;
        }

        if (rev <= getDeltaRevisionFloor(base)) {
          return;
        }

        if (pendingDeltaBaseRevision !== base) {
          pendingDeltaBaseRevision = base;
          pendingDeltaFrames = [];
        }
        if (pendingDeltaFrames) {
          pendingDeltaFrames.push({ rev, patches: payload?.patches });
        }

        if (typeof window === "undefined") {
          flushPendingQueueDelta();
        } else if (pendingDeltaApplyHandle == null && pendingDeltaApplyDeadlineHandle == null) {
          if (typeof window.requestAnimationFrame === "function") {
            pendingDeltaApplyHandle = window.requestAnimationFrame(flushPendingQueueDelta);
            pendingDeltaApplyDeadlineHandle = window.setTimeout(() => {
              pendingDeltaApplyDeadlineHandle = null;
              flushPendingQueueDelta();
            }, UI_FLUSH_DEADLINE_MS);
          } else {
            pendingDeltaApplyHandle = window.setTimeout(flushPendingQueueDelta, 0);
          }
        }

        initialQueuePollCancelled = true;
      },
      { debugLabel: "ffui://queue-state-lite-delta" },
    )
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        unsubscribeQueueDelta = unsubscribe;
      })
      .catch((err) => {
        console.error("Failed to register queue_state_delta listener:", err);
      });

    // Defer the first queue poll behind the startup idle gate while still
    // reacting to push events immediately.
    scheduleInitialQueuePoll();

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
    }

    // Safety net: in case push events stall (IPC hiccup, listener dropped),
    // refresh the lite snapshot at a very low frequency. This intentionally
    // avoids scanning the full job list or keying off "progress==0" heuristics,
    // which can cause refresh storms and UI jank on large queues.
    const SAFETY_REFRESH_INTERVAL_MS = 30_000;
    const SAFETY_REFRESH_STALE_THRESHOLD_MS = 45_000;
    queueTimer = window.setInterval(() => {
      if (jobs.value.length === 0) return;

      const lastSnapshotAt = lastQueueSnapshotAtMs.value;
      const ageMs = typeof lastSnapshotAt === "number" ? Date.now() - lastSnapshotAt : Number.POSITIVE_INFINITY;
      if (ageMs < SAFETY_REFRESH_STALE_THRESHOLD_MS) return;

      void refreshQueueFromBackend();
    }, SAFETY_REFRESH_INTERVAL_MS);
  });

  onUnmounted(() => {
    disposed = true;
    unsubscribeQueueSnapshot?.();
    unsubscribeQueueSnapshot = null;
    unsubscribeQueueDelta?.();
    unsubscribeQueueDelta = null;

    foregroundRefreshController.unmount();

    if (pendingApplyHandle != null && typeof window !== "undefined") {
      if (typeof window.cancelAnimationFrame === "function") {
        try {
          window.cancelAnimationFrame(pendingApplyHandle);
        } catch {
          // ignore
        }
      }
      window.clearTimeout(pendingApplyHandle);
      pendingApplyHandle = null;
    }
    if (pendingApplyDeadlineHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingApplyDeadlineHandle);
      pendingApplyDeadlineHandle = null;
    }
    pendingQueueState = null;

    if (pendingDeltaApplyHandle != null && typeof window !== "undefined") {
      if (typeof window.cancelAnimationFrame === "function") {
        try {
          window.cancelAnimationFrame(pendingDeltaApplyHandle);
        } catch {
          // ignore
        }
      }
      window.clearTimeout(pendingDeltaApplyHandle);
      pendingDeltaApplyHandle = null;
    }
    if (pendingDeltaApplyDeadlineHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingDeltaApplyDeadlineHandle);
      pendingDeltaApplyDeadlineHandle = null;
    }
    pendingDeltaFrames = null;
    pendingDeltaBaseRevision = null;

    if (pendingAheadRefreshHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingAheadRefreshHandle);
      pendingAheadRefreshHandle = null;
    }
    pendingAheadDeltaFrames = null;
    pendingAheadDeltaBaseRevision = null;

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
      queueTimer = undefined;
    }
  });
}
