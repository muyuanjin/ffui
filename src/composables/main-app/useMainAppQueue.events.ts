import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { hasTauri } from "@/lib/backend";
import type { QueueStateLite, TranscodeJob } from "@/types";

interface QueueEventDeps {
  jobs: Ref<TranscodeJob[]>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  lastQueueSnapshotRevision: Ref<number | null>;
  startupIdleReady?: Ref<boolean>;
  refreshQueueFromBackend: () => Promise<void>;
  applyQueueStateFromBackend: (state: QueueStateLite) => void;
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
}: QueueEventDeps): void {
  let queueUnlisten: UnlistenFn | null = null;
  let queueTimer: number | undefined;
  let initialQueuePollScheduled = false;
  let initialQueuePollCancelled = false;
  let pendingQueueState: QueueStateLite | null = null;
  let pendingApplyHandle: number | null = null;

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

  onMounted(() => {
    if (!hasTauri()) {
      return;
    }

    void listen<QueueStateLite>("ffui://queue-state-lite", (event) => {
      const payload = event.payload;
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
        const next = pendingQueueState;
        pendingQueueState = null;
        if (next) applyQueueStateFromBackend(next);
      } else if (pendingApplyHandle == null) {
        const flush = () => {
          pendingApplyHandle = null;
          const next = pendingQueueState;
          pendingQueueState = null;
          if (next) applyQueueStateFromBackend(next);
        };
        if (typeof window.requestAnimationFrame === "function") {
          pendingApplyHandle = window.requestAnimationFrame(flush);
        } else {
          pendingApplyHandle = window.setTimeout(flush, 0);
        }
      }
      // Any push-style queue event cancels the deferred initial poll so we
      // avoid issuing a redundant full snapshot request on startup.
      initialQueuePollCancelled = true;
    })
      .then((unlisten) => {
        queueUnlisten = unlisten;
      })
      .catch((err) => {
        console.error("Failed to register queue_state listener:", err);
      });

    // Defer the first queue poll behind the startup idle gate while still
    // reacting to push events immediately.
    scheduleInitialQueuePoll();

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
    }

    queueTimer = window.setInterval(() => {
      const snapshot = jobs.value;
      if (!snapshot || snapshot.length === 0) return;

      const hasStuckProcessingJob = snapshot.some(
        (job) => job.status === "processing" && (!job.progress || job.progress <= 0),
      );
      if (!hasStuckProcessingJob) return;

      const lastSnapshotAt = lastQueueSnapshotAtMs.value;
      const ageMs = typeof lastSnapshotAt === "number" ? Date.now() - lastSnapshotAt : Number.POSITIVE_INFINITY;

      if (ageMs > 5000) {
        void refreshQueueFromBackend();
      }
    }, 3000);
  });

  onUnmounted(() => {
    if (queueUnlisten) {
      try {
        queueUnlisten();
      } catch (err) {
        console.error("Failed to unlisten queue_state event:", err);
      } finally {
        queueUnlisten = null;
      }
    }

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
    pendingQueueState = null;

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
      queueTimer = undefined;
    }
  });
}
