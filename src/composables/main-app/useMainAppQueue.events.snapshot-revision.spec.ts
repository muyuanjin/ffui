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
  const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  let capturedHandler: ((event: { payload: unknown }) => void) | null = null;
  let capturedDeltaHandler: ((event: { payload: unknown }) => void) | null = null;
  let capturedWindowFocusHandler: ((event: { payload: unknown }) => void) | null = null;
  let capturedWindowBlurHandler: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    capturedHandler = null;
    capturedDeltaHandler = null;
    capturedWindowFocusHandler = null;
    capturedWindowBlurHandler = null;
    listenMock.mockReset();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state-lite") {
        capturedHandler = handler;
      }
      if (event === "ffui://queue-state-lite-delta") {
        capturedDeltaHandler = handler;
      }
      if (event === "tauri://focus") {
        capturedWindowFocusHandler = handler;
      }
      if (event === "tauri://blur") {
        capturedWindowBlurHandler = handler;
      }
      return () => {};
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, "visibilityState", originalVisibilityStateDescriptor);
    } else {
      delete (document as any).visibilityState;
    }
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
        patches: [{ id: "job-1", preview: { previewPath: "C:/previews/job-1.jpg", previewRevision: 5 } }],
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

  it("filters stale deltas after an external refresh before coalescing a newer sparse patch", async () => {
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

    expect(capturedDeltaHandler).toBeTypeOf("function");

    applyQueueStateFromBackend(
      {
        snapshotRevision: 2,
        latestDeltaRevision: 10,
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
      deps,
    );

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 5,
        patches: [{ id: "job-1", progress: 20 }],
      } satisfies QueueStateLiteDelta,
    });
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 11,
        patches: [{ id: "job-1", status: "paused" }],
      } satisfies QueueStateLiteDelta,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(jobs.value[0].status).toBe("paused");

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

  it("flushes buffered ahead deltas after an external refresh and still filters stale revisions from the merged result", async () => {
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

    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 5,
        patches: [{ id: "job-1", progress: 20 }],
      } satisfies QueueStateLiteDelta,
    });
    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 11,
        patches: [{ id: "job-1", status: "completed" }],
      } satisfies QueueStateLiteDelta,
    });

    applyQueueStateFromBackend(
      {
        snapshotRevision: 2,
        latestDeltaRevision: 10,
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
      deps,
    );

    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(jobs.value[0].status).toBe("completed");
    expect(lastQueueSnapshotRevision.value).toBe(2);

    wrapper.unmount();
  });

  it("triggers only one foreground refresh when active queue data is stale on resume", async () => {
    vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));

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

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-foreground-stale",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 12,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    expect(lastQueueSnapshotAtMs.value).not.toBeNull();

    vi.setSystemTime(new Date("2026-03-30T00:00:03.000Z"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("forces an immediate foreground refresh after returning from hidden even when the last snapshot is still fresh", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));

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

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-hidden-resume",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 12,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    expect(lastQueueSnapshotAtMs.value).not.toBeNull();

    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();

    vi.setSystemTime(new Date("2026-03-30T00:00:00.500Z"));
    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("bypasses the ahead-delta delay with a single foreground refresh on resume", async () => {
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

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-ahead-delta",
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

    capturedDeltaHandler!({
      payload: {
        baseSnapshotRevision: 2,
        deltaRevision: 1,
        patches: [{ id: "job-ahead-delta", status: "processing", progress: 55 }],
      } satisfies QueueStateLiteDelta,
    });

    await nextTick();
    expect(refreshSpy).toHaveBeenCalledTimes(0);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("forces an immediate foreground refresh on tauri window focus even when DOM visibility never became hidden", async () => {
    vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));

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

    expect(capturedWindowFocusHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-tauri-focus-resume",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 12,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    expect(lastQueueSnapshotAtMs.value).not.toBeNull();

    vi.setSystemTime(new Date("2026-03-30T00:00:00.500Z"));
    capturedWindowFocusHandler!({ payload: null });
    await nextTick();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("forces an immediate foreground refresh when tauri blur marks the window backgrounded before a DOM focus resume", async () => {
    vi.setSystemTime(new Date("2026-03-30T00:00:00.000Z"));

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

    expect(capturedWindowBlurHandler).toBeTypeOf("function");

    capturedHandler!({
      payload: {
        snapshotRevision: 1,
        jobs: [
          {
            id: "job-tauri-blur-resume",
            filename: "a.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 12,
          },
        ],
      } satisfies QueueStateLite,
    });

    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    expect(lastQueueSnapshotAtMs.value).not.toBeNull();

    capturedWindowBlurHandler!({ payload: null });
    await nextTick();

    vi.setSystemTime(new Date("2026-03-30T00:00:00.500Z"));
    window.dispatchEvent(new Event("focus"));
    await nextTick();

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
