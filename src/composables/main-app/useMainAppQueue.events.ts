import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { hasTauri } from "@/lib/backend";
import type { QueueStateLite, QueueStateLiteDelta, TranscodeJob } from "@/types";
import { recordQueueEvent } from "@/lib/queuePerf";

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
  let queueUnlisten: UnlistenFn | null = null;
  let queueDeltaUnlisten: UnlistenFn | null = null;
  let queueTimer: number | undefined;
  let initialQueuePollScheduled = false;
  let initialQueuePollCancelled = false;
  let pendingQueueState: QueueStateLite | null = null;
  let pendingApplyHandle: number | null = null;
  let pendingDeltaBaseRevision: number | null = null;
  let pendingDeltaMaxRevision: number | null = null;
  let pendingDeltaPatchesById: Map<string, { rev: number; patch: QueueStateLiteDelta["patches"][number] }> | null =
    null;
  let pendingDeltaApplyHandle: number | null = null;
  let lastAppliedDeltaBaseRevision: number | null = null;
  let lastAppliedDeltaRevision: number | null = null;
  let pendingAheadDeltaBaseRevision: number | null = null;
  let pendingAheadDeltaMaxRevision: number | null = null;
  let pendingAheadDeltaPatchesById: Map<string, { rev: number; patch: QueueStateLiteDelta["patches"][number] }> | null =
    null;
  let pendingAheadRefreshHandle: number | null = null;
  let lastAheadRefreshAtMs = 0;

  const AHEAD_REFRESH_DELAY_MS = 5_000;
  const AHEAD_REFRESH_MIN_INTERVAL_MS = 30_000;

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
    const maxRev = pendingAheadDeltaMaxRevision;
    const patchesById = pendingAheadDeltaPatchesById;
    if (base == null || maxRev == null || !patchesById) return;

    const currentSnapshotRevision = lastQueueSnapshotRevision.value;
    if (typeof currentSnapshotRevision !== "number" || !Number.isFinite(currentSnapshotRevision)) return;

    if (base < currentSnapshotRevision) {
      pendingAheadDeltaBaseRevision = null;
      pendingAheadDeltaMaxRevision = null;
      pendingAheadDeltaPatchesById = null;
      return;
    }

    if (base !== currentSnapshotRevision) return;

    const delta: QueueStateLiteDelta = {
      baseSnapshotRevision: base,
      deltaRevision: maxRev,
      patches: Array.from(patchesById.values()).map((v) => v.patch),
    };
    pendingAheadDeltaBaseRevision = null;
    pendingAheadDeltaMaxRevision = null;
    pendingAheadDeltaPatchesById = null;

    applyQueueStateLiteDeltaFromBackend(delta);
    lastAppliedDeltaBaseRevision = base;
    lastAppliedDeltaRevision = delta.deltaRevision;
  };

  onMounted(() => {
    if (!hasTauri()) {
      return;
    }

    void listen<QueueStateLite>("ffui://queue-state-lite", (event) => {
      const payload = event.payload;
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
        const next = pendingQueueState;
        pendingQueueState = null;
        if (next) applyQueueStateFromBackend(next);
        lastAppliedDeltaBaseRevision = lastQueueSnapshotRevision.value;
        lastAppliedDeltaRevision = null;
        flushPendingAheadDeltaIfReady();
      } else if (pendingApplyHandle == null) {
        const flush = () => {
          pendingApplyHandle = null;
          const next = pendingQueueState;
          pendingQueueState = null;
          if (next) applyQueueStateFromBackend(next);
          lastAppliedDeltaBaseRevision = lastQueueSnapshotRevision.value;
          lastAppliedDeltaRevision = null;
          flushPendingAheadDeltaIfReady();
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

    void listen<QueueStateLiteDelta>("ffui://queue-state-lite-delta", (event) => {
      const payload = event.payload;
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
          pendingAheadDeltaMaxRevision = rev;
          pendingAheadDeltaPatchesById = new Map();
        } else {
          pendingAheadDeltaMaxRevision =
            pendingAheadDeltaMaxRevision == null ? rev : Math.max(pendingAheadDeltaMaxRevision, rev);
        }

        const patches = payload?.patches ?? [];
        if (Array.isArray(patches) && pendingAheadDeltaPatchesById) {
          for (const patch of patches) {
            const id = patch?.id;
            if (!id) continue;
            const existing = pendingAheadDeltaPatchesById.get(id);
            if (!existing || rev >= existing.rev) {
              pendingAheadDeltaPatchesById.set(id, { rev, patch });
            }
          }
        }

        scheduleAheadRefresh();
        return;
      }

      if (lastAppliedDeltaBaseRevision !== base) {
        lastAppliedDeltaBaseRevision = base;
        lastAppliedDeltaRevision = null;
      }
      if (typeof lastAppliedDeltaRevision === "number" && rev < lastAppliedDeltaRevision) {
        return;
      }

      if (pendingDeltaBaseRevision !== base) {
        pendingDeltaBaseRevision = base;
        pendingDeltaMaxRevision = rev;
        pendingDeltaPatchesById = new Map();
      } else {
        pendingDeltaMaxRevision = pendingDeltaMaxRevision == null ? rev : Math.max(pendingDeltaMaxRevision, rev);
      }

      const patches = payload?.patches ?? [];
      if (Array.isArray(patches) && pendingDeltaPatchesById) {
        for (const patch of patches) {
          const id = patch?.id;
          if (!id) continue;
          const existing = pendingDeltaPatchesById.get(id);
          if (!existing || rev >= existing.rev) {
            pendingDeltaPatchesById.set(id, { rev, patch });
          }
        }
      }

      if (typeof window === "undefined") {
        if (!pendingDeltaPatchesById || pendingDeltaBaseRevision == null || pendingDeltaMaxRevision == null) return;
        const delta: QueueStateLiteDelta = {
          baseSnapshotRevision: pendingDeltaBaseRevision,
          deltaRevision: pendingDeltaMaxRevision,
          patches: Array.from(pendingDeltaPatchesById.values()).map((v) => v.patch),
        };
        pendingDeltaPatchesById = null;
        pendingDeltaBaseRevision = null;
        pendingDeltaMaxRevision = null;
        applyQueueStateLiteDeltaFromBackend(delta);
        lastAppliedDeltaRevision = delta.deltaRevision;
      } else if (pendingDeltaApplyHandle == null) {
        const flushDelta = () => {
          pendingDeltaApplyHandle = null;
          if (!pendingDeltaPatchesById || pendingDeltaBaseRevision == null || pendingDeltaMaxRevision == null) return;

          const delta: QueueStateLiteDelta = {
            baseSnapshotRevision: pendingDeltaBaseRevision,
            deltaRevision: pendingDeltaMaxRevision,
            patches: Array.from(pendingDeltaPatchesById.values()).map((v) => v.patch),
          };
          pendingDeltaPatchesById = null;
          pendingDeltaBaseRevision = null;
          pendingDeltaMaxRevision = null;

          applyQueueStateLiteDeltaFromBackend(delta);
          lastAppliedDeltaRevision = delta.deltaRevision;
        };

        if (typeof window.requestAnimationFrame === "function") {
          pendingDeltaApplyHandle = window.requestAnimationFrame(flushDelta);
        } else {
          pendingDeltaApplyHandle = window.setTimeout(flushDelta, 0);
        }
      }

      initialQueuePollCancelled = true;
    })
      .then((unlisten) => {
        queueDeltaUnlisten = unlisten;
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
    if (queueUnlisten) {
      try {
        queueUnlisten();
      } catch (err) {
        console.error("Failed to unlisten queue_state event:", err);
      } finally {
        queueUnlisten = null;
      }
    }
    if (queueDeltaUnlisten) {
      try {
        queueDeltaUnlisten();
      } catch (err) {
        console.error("Failed to unlisten queue_state_delta event:", err);
      } finally {
        queueDeltaUnlisten = null;
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
    pendingDeltaPatchesById = null;
    pendingDeltaBaseRevision = null;
    pendingDeltaMaxRevision = null;

    if (pendingAheadRefreshHandle != null && typeof window !== "undefined") {
      window.clearTimeout(pendingAheadRefreshHandle);
      pendingAheadRefreshHandle = null;
    }
    pendingAheadDeltaPatchesById = null;
    pendingAheadDeltaBaseRevision = null;
    pendingAheadDeltaMaxRevision = null;

    if (queueTimer !== undefined) {
      clearInterval(queueTimer);
      queueTimer = undefined;
    }
  });
}
