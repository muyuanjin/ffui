import { isPerfLoggingEnabled, perfLog } from "@/lib/perfLog";

type QueueUpdateKind = "snapshot" | "delta";

type QueuePerfState = {
  startedAtMs: number;

  snapshotEvents: number;
  deltaEvents: number;
  deltaPatches: number;

  snapshotPayloadBytesSampled: number | null;
  deltaPayloadBytesSampled: number | null;
  lastPayloadSampleAtMs: number;

  applySnapshotCalls: number;
  applyDeltaCalls: number;
  applySnapshotTotalMs: number;
  applyDeltaTotalMs: number;
  applySnapshotLastMs: number | null;
  applyDeltaLastMs: number | null;

  queueItemUpdates: number;
  queueIconItemUpdates: number;
  queuePanelVirtualRowsBuilds: number;
  queuePanelVirtualRowsTotalMs: number;
  queuePanelVirtualRowsLastMs: number | null;

  rafFrames: number;
  rafLastSampleAtMs: number;
  rafFps: number | null;

  loopLagSamples: number[];
  loopLagP95Ms: number | null;
  loopLagLastSampleAtMs: number;

  lastLogAtMs: number;
};

const perfEnabled = (() => {
  if (!isPerfLoggingEnabled) return false;
  if (typeof import.meta === "undefined" || typeof import.meta.env === "undefined") return false;
  if (import.meta.env.MODE === "test") return false;
  return Boolean(import.meta.env.DEV || import.meta.env.VITE_LOG_PERF === "1");
})();

const nowMs = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const state: QueuePerfState | null = perfEnabled
  ? {
      startedAtMs: nowMs(),
      snapshotEvents: 0,
      deltaEvents: 0,
      deltaPatches: 0,
      snapshotPayloadBytesSampled: null,
      deltaPayloadBytesSampled: null,
      lastPayloadSampleAtMs: 0,
      applySnapshotCalls: 0,
      applyDeltaCalls: 0,
      applySnapshotTotalMs: 0,
      applyDeltaTotalMs: 0,
      applySnapshotLastMs: null,
      applyDeltaLastMs: null,
      queueItemUpdates: 0,
      queueIconItemUpdates: 0,
      queuePanelVirtualRowsBuilds: 0,
      queuePanelVirtualRowsTotalMs: 0,
      queuePanelVirtualRowsLastMs: null,
      rafFrames: 0,
      rafLastSampleAtMs: 0,
      rafFps: null,
      loopLagSamples: [],
      loopLagP95Ms: null,
      loopLagLastSampleAtMs: 0,
      lastLogAtMs: 0,
    }
  : null;

let monitorsStarted = false;

const ensureMonitors = () => {
  if (!state) return;
  if (monitorsStarted) return;
  if (typeof window === "undefined") return;
  monitorsStarted = true;

  state.rafLastSampleAtMs = nowMs();
  const rafTick = () => {
    if (!state) return;
    state.rafFrames += 1;
    const now = nowMs();
    if (now - state.rafLastSampleAtMs >= 1000) {
      const dt = now - state.rafLastSampleAtMs;
      state.rafFps = dt > 0 ? (state.rafFrames * 1000) / dt : null;
      state.rafFrames = 0;
      state.rafLastSampleAtMs = now;
    }
    window.requestAnimationFrame(rafTick);
  };
  window.requestAnimationFrame(rafTick);

  const LAG_SAMPLE_INTERVAL_MS = 100;
  const LAG_WINDOW_SAMPLES = 300;
  let expected = nowMs() + LAG_SAMPLE_INTERVAL_MS;
  state.loopLagLastSampleAtMs = nowMs();
  window.setInterval(() => {
    if (!state) return;
    const now = nowMs();
    const lag = Math.max(0, now - expected);
    expected = now + LAG_SAMPLE_INTERVAL_MS;
    state.loopLagSamples.push(lag);
    if (state.loopLagSamples.length > LAG_WINDOW_SAMPLES) {
      state.loopLagSamples.splice(0, state.loopLagSamples.length - LAG_WINDOW_SAMPLES);
    }

    if (now - state.loopLagLastSampleAtMs >= 2000) {
      const sorted = [...state.loopLagSamples].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      state.loopLagP95Ms = sorted.length > 0 ? sorted[idx] : null;
      state.loopLagLastSampleAtMs = now;
    }
  }, LAG_SAMPLE_INTERVAL_MS);
};

const maybeExposeAndLog = () => {
  if (!state) return;
  ensureMonitors();

  if (typeof window !== "undefined") {
    window.__FFUI_QUEUE_PERF__ = {
      uptimeMs: nowMs() - state.startedAtMs,
      events: {
        snapshots: state.snapshotEvents,
        deltas: state.deltaEvents,
        deltaPatches: state.deltaPatches,
        snapshotPayloadBytesSampled: state.snapshotPayloadBytesSampled,
        deltaPayloadBytesSampled: state.deltaPayloadBytesSampled,
      },
      apply: {
        snapshotCalls: state.applySnapshotCalls,
        deltaCalls: state.applyDeltaCalls,
        snapshotAvgMs: state.applySnapshotCalls ? state.applySnapshotTotalMs / state.applySnapshotCalls : null,
        deltaAvgMs: state.applyDeltaCalls ? state.applyDeltaTotalMs / state.applyDeltaCalls : null,
        snapshotLastMs: state.applySnapshotLastMs,
        deltaLastMs: state.applyDeltaLastMs,
      },
      ui: {
        queueItemUpdates: state.queueItemUpdates,
        queueIconItemUpdates: state.queueIconItemUpdates,
        queuePanelVirtualRowsBuilds: state.queuePanelVirtualRowsBuilds,
        queuePanelVirtualRowsAvgMs: state.queuePanelVirtualRowsBuilds
          ? state.queuePanelVirtualRowsTotalMs / state.queuePanelVirtualRowsBuilds
          : null,
        queuePanelVirtualRowsLastMs: state.queuePanelVirtualRowsLastMs,
      },
      loop: {
        rafFps: state.rafFps,
        eventLoopLagP95Ms: state.loopLagP95Ms,
      },
    } satisfies FfuiQueuePerfSnapshot;
  }

  const now = nowMs();
  if (now - state.lastLogAtMs < 2000) return;
  state.lastLogAtMs = now;

  perfLog(
    [
      "[perf] queue",
      `events: snapshot=${state.snapshotEvents} delta=${state.deltaEvents} patches=${state.deltaPatches}`,
      state.snapshotPayloadBytesSampled != null ? `snapshotBytes≈${state.snapshotPayloadBytesSampled}` : null,
      state.deltaPayloadBytesSampled != null ? `deltaBytes≈${state.deltaPayloadBytesSampled}` : null,
      `applyAvgMs: snapshot=${state.applySnapshotCalls ? (state.applySnapshotTotalMs / state.applySnapshotCalls).toFixed(3) : "n/a"}`,
      `delta=${state.applyDeltaCalls ? (state.applyDeltaTotalMs / state.applyDeltaCalls).toFixed(3) : "n/a"}`,
      `rowsAvgMs=${state.queuePanelVirtualRowsBuilds ? (state.queuePanelVirtualRowsTotalMs / state.queuePanelVirtualRowsBuilds).toFixed(3) : "n/a"}`,
      state.rafFps != null ? `fps≈${state.rafFps.toFixed(1)}` : null,
      state.loopLagP95Ms != null ? `loopLagP95≈${state.loopLagP95Ms.toFixed(1)}ms` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );
};

const samplePayloadBytes = (kind: QueueUpdateKind, payload: unknown) => {
  if (!state) return;
  if (typeof payload === "undefined") return;

  const now = nowMs();
  if (now - state.lastPayloadSampleAtMs < 1000) return;
  state.lastPayloadSampleAtMs = now;

  // Avoid JSON.stringify() here: snapshots can be large and stringifying them on
  // the UI thread causes exactly the kind of jank this profiler is trying to
  // detect. Payload byte metrics should be captured on the Rust side (where the
  // JSON is produced) if needed.
  let bytes: number | null = null;
  if (typeof payload === "string") {
    bytes = payload.length;
  } else if (payload instanceof ArrayBuffer) {
    bytes = payload.byteLength;
  } else if (payload instanceof Uint8Array) {
    bytes = payload.byteLength;
  }

  if (kind === "snapshot") {
    state.snapshotPayloadBytesSampled = bytes;
  } else {
    state.deltaPayloadBytesSampled = bytes;
  }
};

export const isQueuePerfEnabled = perfEnabled;

export const recordQueueEvent = (kind: QueueUpdateKind, payload?: unknown, patchCount?: number) => {
  if (!state) return;
  if (kind === "snapshot") {
    state.snapshotEvents += 1;
    samplePayloadBytes(kind, payload);
  } else {
    state.deltaEvents += 1;
    state.deltaPatches += Math.max(0, Number(patchCount ?? 0) || 0);
    samplePayloadBytes(kind, payload);
  }
  maybeExposeAndLog();
};

export const measureQueueApply = <T>(kind: QueueUpdateKind, fn: () => T): T => {
  if (!state) return fn();
  const started = nowMs();
  const result = fn();
  const elapsed = Math.max(0, nowMs() - started);

  if (kind === "snapshot") {
    state.applySnapshotCalls += 1;
    state.applySnapshotTotalMs += elapsed;
    state.applySnapshotLastMs = elapsed;
  } else {
    state.applyDeltaCalls += 1;
    state.applyDeltaTotalMs += elapsed;
    state.applyDeltaLastMs = elapsed;
  }

  maybeExposeAndLog();
  return result;
};

export const recordQueueItemUpdate = () => {
  if (!state) return;
  state.queueItemUpdates += 1;
  maybeExposeAndLog();
};

export const recordQueueIconItemUpdate = () => {
  if (!state) return;
  state.queueIconItemUpdates += 1;
  maybeExposeAndLog();
};

export const recordQueuePanelVirtualRowsBuild = (elapsedMs: number) => {
  if (!state) return;
  state.queuePanelVirtualRowsBuilds += 1;
  state.queuePanelVirtualRowsTotalMs += Math.max(0, elapsedMs);
  state.queuePanelVirtualRowsLastMs = Math.max(0, elapsedMs);
  maybeExposeAndLog();
};
