// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, nextTick, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import type { QueueStateLite, QueueStateLiteDelta, TranscodeJob } from "@/types";

const listenMock = vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>();
const isMinimizedMock = vi.fn<() => Promise<boolean>>();

vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: Parameters<typeof listenMock>) => listenMock(...args) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMinimized: () => isMinimizedMock(),
  }),
}));
vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return { ...actual, hasTauri: () => true };
});

import { useQueueEventListeners } from "./useMainAppQueue.events";
import {
  applyQueueStateFromBackend,
  applyQueueStateLiteDeltaFromBackend,
  type StateSyncDeps,
} from "@/composables/queue/operations-state-sync";

function makeJob(id: string, progress = 0): TranscodeJob {
  return {
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    presetId: "preset-1",
    status: "processing",
    progress,
  };
}

function createHarness(overrides: { refreshQueueFromBackend?: () => Promise<void> } = {}) {
  const jobs = ref<TranscodeJob[]>([]);
  const queueError = ref<string | null>(null);
  const lastQueueSnapshotAtMs = ref<number | null>(null);
  const lastQueueSnapshotRevision = ref<number | null>(null);
  const startupIdleReady = ref(false);
  const appliedDeltas: QueueStateLiteDelta[] = [];

  const deps: StateSyncDeps & { jobs: Ref<TranscodeJob[]> } = {
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
  };

  const TestHarness = defineComponent({
    setup() {
      useQueueEventListeners({
        jobs,
        lastQueueSnapshotAtMs,
        lastQueueSnapshotRevision,
        startupIdleReady,
        refreshQueueFromBackend: overrides.refreshQueueFromBackend ?? (async () => {}),
        applyQueueStateFromBackend: (state: QueueStateLite) => applyQueueStateFromBackend(state, deps),
        applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) => {
          appliedDeltas.push(delta);
          applyQueueStateLiteDeltaFromBackend(delta, deps);
        },
      });
      return {};
    },
    template: "<div />",
  });

  return { TestHarness, deps, jobs, lastQueueSnapshotRevision, appliedDeltas };
}

describe("useQueueEventListeners latest-wins queue progress sync", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  let capturedSnapshotHandler: ((event: { payload: unknown }) => void) | null = null;
  let capturedDeltaHandler: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    capturedSnapshotHandler = null;
    capturedDeltaHandler = null;
    listenMock.mockReset();
    isMinimizedMock.mockReset();
    isMinimizedMock.mockResolvedValue(false);
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state-lite") capturedSnapshotHandler = handler;
      if (event === "ffui://queue-state-lite-delta") capturedDeltaHandler = handler;
      return () => {};
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("applies progress within one second when blurred, not minimized, and requestAnimationFrame does not run", async () => {
    (window as any).requestAnimationFrame = vi.fn(() => 1);
    (window as any).cancelAnimationFrame = vi.fn(() => {});

    const { TestHarness, jobs } = createHarness();
    const wrapper = mount(TestHarness);
    await nextTick();

    capturedSnapshotHandler!({
      payload: { snapshotRevision: 1, jobs: [makeJob("job-1", 0)] } satisfies QueueStateLite,
    });
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    window.dispatchEvent(new Event("blur"));
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [{ id: "job-1", progress: 42 }],
      } satisfies QueueStateLiteDelta,
    });

    vi.advanceTimersByTime(1_000);
    await nextTick();

    expect(isMinimizedMock).toHaveBeenCalled();
    expect(jobs.value[0].progress).toBe(42);

    wrapper.unmount();
  });

  it("coalesces 1000 same-job progress deltas into one latest patch", async () => {
    (window as any).requestAnimationFrame = vi.fn(() => 1);
    (window as any).cancelAnimationFrame = vi.fn(() => {});

    const { TestHarness, jobs, appliedDeltas } = createHarness();
    const wrapper = mount(TestHarness);
    await nextTick();

    capturedSnapshotHandler!({
      payload: { snapshotRevision: 1, jobs: [makeJob("job-1", 0)] } satisfies QueueStateLite,
    });
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    for (let idx = 1; idx <= 1_000; idx += 1) {
      capturedDeltaHandler!({
        payload: {
          baseSnapshotRevision: 1,
          deltaRevision: idx,
          patches: [{ id: "job-1", progress: idx / 10 }],
        } satisfies QueueStateLiteDelta,
      });
    }

    vi.advanceTimersByTime(150);
    await nextTick();

    const latestDelta = appliedDeltas[appliedDeltas.length - 1];
    expect(latestDelta?.deltaRevision).toBe(1_000);
    expect(latestDelta?.patches).toEqual([{ id: "job-1", progress: 100 }]);
    expect(jobs.value[0].progress).toBe(100);

    wrapper.unmount();
  });

  it("keeps pending patches bounded by processing job count and preserves unaffected job identity", async () => {
    (window as any).requestAnimationFrame = vi.fn(() => 1);
    (window as any).cancelAnimationFrame = vi.fn(() => {});

    const { TestHarness, jobs, appliedDeltas } = createHarness();
    const wrapper = mount(TestHarness);
    await nextTick();

    capturedSnapshotHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [makeJob("job-a", 0), makeJob("job-b", 0), makeJob("job-c", 0), makeJob("job-idle", 0)],
      } satisfies QueueStateLite,
    });
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    const beforeArray = jobs.value;
    const idleJob = jobs.value[3];

    for (let idx = 1; idx <= 1_000; idx += 1) {
      const id = idx % 3 === 0 ? "job-a" : idx % 3 === 1 ? "job-b" : "job-c";
      capturedDeltaHandler!({
        payload: {
          baseSnapshotRevision: 1,
          deltaRevision: idx,
          patches: [{ id, progress: idx }],
        } satisfies QueueStateLiteDelta,
      });
    }

    vi.advanceTimersByTime(150);
    await nextTick();

    const latestDelta = appliedDeltas[appliedDeltas.length - 1];
    expect(latestDelta?.patches).toHaveLength(3);
    expect(new Set(latestDelta?.patches.map((patch) => patch.id))).toEqual(new Set(["job-a", "job-b", "job-c"]));
    expect(jobs.value).toBe(beforeArray);
    expect(jobs.value[3]).toBe(idleJob);

    wrapper.unmount();
  });

  it("refreshes immediately for a visible ahead delta and prevents stale pending progress from overriding the snapshot", async () => {
    (window as any).requestAnimationFrame = vi.fn(() => 1);
    (window as any).cancelAnimationFrame = vi.fn(() => {});

    const depsRef: { current?: StateSyncDeps } = {};
    const refreshQueueFromBackend = vi.fn(async () => {
      const deps = depsRef.current;
      if (!deps) throw new Error("test deps not initialized");
      applyQueueStateFromBackend(
        {
          snapshotRevision: 2,
          latestDeltaRevision: 5,
          jobs: [makeJob("job-1", 50)],
        } satisfies QueueStateLite,
        deps,
      );
    });

    const harness = createHarness({ refreshQueueFromBackend });
    depsRef.current = harness.deps;
    const wrapper = mount(harness.TestHarness);
    await nextTick();

    capturedSnapshotHandler!({
      payload: { snapshotRevision: 1, jobs: [makeJob("job-1", 0)] } satisfies QueueStateLite,
    });
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 5,
        patches: [{ id: "job-1", progress: 20 }],
      } satisfies QueueStateLiteDelta,
    });
    await nextTick();
    await Promise.resolve();

    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
    expect(harness.lastQueueSnapshotRevision.value).toBe(2);

    vi.advanceTimersByTime(1_000);
    await nextTick();

    expect(harness.jobs.value[0].progress).toBe(50);

    wrapper.unmount();
  });
});
