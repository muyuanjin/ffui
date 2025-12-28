// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, nextTick, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import type { QueueStateLite, QueueStateLiteDelta, TranscodeJob } from "@/types";

const listenMock = vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>();

vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: Parameters<typeof listenMock>) => listenMock(...args) }));
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

describe("useQueueEventListeners snapshotRevision ordering", () => {
  let capturedHandler: ((event: { payload: unknown }) => void) | null = null;
  let capturedDeltaHandler: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    capturedHandler = null;
    capturedDeltaHandler = null;
    listenMock.mockReset();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state-lite") {
        capturedHandler = handler;
      }
      if (event === "ffui://queue-state-lite-delta") {
        capturedDeltaHandler = handler;
      }
      return () => {};
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops out-of-order queue-state-lite updates so progress never regresses", async () => {
    const jobs = ref<TranscodeJob[]>([]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const startupIdleReady = ref(false);

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
          refreshQueueFromBackend: async () => {},
          applyQueueStateFromBackend: (state: QueueStateLite) => applyQueueStateFromBackend(state, deps),
          applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) =>
            applyQueueStateLiteDeltaFromBackend(delta, deps),
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    expect(capturedHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 2,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 50,
          },
        ],
      } satisfies QueueStateLite,
    });
    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 10,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(lastQueueSnapshotRevision.value).toBe(2);

    wrapper.unmount();
  });

  it("drops out-of-order queue-state-lite-delta updates so progress never regresses", async () => {
    const jobs = ref<TranscodeJob[]>([]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const startupIdleReady = ref(false);

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
          refreshQueueFromBackend: async () => {},
          applyQueueStateFromBackend: (state: QueueStateLite) => applyQueueStateFromBackend(state, deps),
          applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) =>
            applyQueueStateLiteDeltaFromBackend(delta, deps),
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    expect(capturedHandler).toBeTypeOf("function");
    expect(capturedDeltaHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 2,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 0,
          },
        ],
      } satisfies QueueStateLite,
    });

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 2,
        patches: [{ id: "job-1", status: "processing", progress: 50 }],
      } satisfies QueueStateLiteDelta,
    });
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 1,
        patches: [{ id: "job-1", status: "processing", progress: 10 }],
      } satisfies QueueStateLiteDelta,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(lastQueueSnapshotRevision.value).toBe(2);

    wrapper.unmount();
  });

  it("merges sparse queue-state-lite-delta patches so status updates are not dropped", async () => {
    const jobs = ref<TranscodeJob[]>([]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const startupIdleReady = ref(false);

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
          refreshQueueFromBackend: async () => {},
          applyQueueStateFromBackend: (state: QueueStateLite) => applyQueueStateFromBackend(state, deps),
          applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) =>
            applyQueueStateLiteDeltaFromBackend(delta, deps),
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    expect(capturedHandler).toBeTypeOf("function");
    expect(capturedDeltaHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 2,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "paused",
            progress: 0,
          },
        ],
      } satisfies QueueStateLite,
    });

    // Same job id, same baseSnapshotRevision, higher deltaRevision:
    // the preview-only patch must not wipe the earlier status/progress update.
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 1,
        patches: [{ id: "job-1", status: "processing", progress: 10 }],
      } satisfies QueueStateLiteDelta,
    });
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 2,
        patches: [{ id: "job-1", previewPath: "C:/previews/job-1.jpg", previewRevision: 5 }],
      } satisfies QueueStateLiteDelta,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].status).toBe("processing");
    expect(jobs.value[0].progress).toBe(10);
    expect(jobs.value[0].previewPath).toBe("C:/previews/job-1.jpg");
    expect(jobs.value[0].previewRevision).toBe(5);

    wrapper.unmount();
  });

  it("buffers deltas for a newer baseSnapshotRevision until the matching snapshot arrives", async () => {
    const jobs = ref<TranscodeJob[]>([]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const startupIdleReady = ref(false);

    const deps: StateSyncDeps & { jobs: Ref<TranscodeJob[]> } = {
      jobs,
      queueError,
      lastQueueSnapshotAtMs,
      lastQueueSnapshotRevision,
    };

    const refreshSpy = vi.fn(async () => {});

    const TestHarness = defineComponent({
      setup() {
        useQueueEventListeners({
          jobs,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          startupIdleReady,
          refreshQueueFromBackend: refreshSpy,
          applyQueueStateFromBackend: (state: QueueStateLite) => applyQueueStateFromBackend(state, deps),
          applyQueueStateLiteDeltaFromBackend: (delta: QueueStateLiteDelta) =>
            applyQueueStateLiteDeltaFromBackend(delta, deps),
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    expect(capturedHandler).toBeTypeOf("function");
    expect(capturedDeltaHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 0,
          },
        ],
      } satisfies QueueStateLite,
    });

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 1,
        patches: [{ id: "job-1", status: "processing", progress: 50 }],
      } satisfies QueueStateLiteDelta,
    });

    capturedHandler!({
      payload: {
        snapshotRevision: 2,
        jobs: [
          {
            id: "job-1",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 0,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(lastQueueSnapshotRevision.value).toBe(2);

    wrapper.unmount();
  });
});
