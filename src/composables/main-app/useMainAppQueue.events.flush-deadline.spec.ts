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

describe("useQueueEventListeners flush deadline", () => {
  const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  let capturedSnapshotHandler: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    capturedSnapshotHandler = null;
    listenMock.mockReset();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state-lite") {
        capturedSnapshotHandler = handler;
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
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("flushes a pending snapshot even when requestAnimationFrame is throttled", async () => {
    const raf = vi.fn(() => 1);
    const cancel = vi.fn(() => {});
    (window as any).requestAnimationFrame = raf;
    (window as any).cancelAnimationFrame = cancel;

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

    expect(typeof capturedSnapshotHandler).toBe("function");

    capturedSnapshotHandler!({
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
            progress: 50,
          },
        ],
      } satisfies QueueStateLite,
    });

    // rAF is "scheduled" but never executed; the deadline timer must flush.
    vi.advanceTimersByTime(150);
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(50);
    expect(lastQueueSnapshotRevision.value).toBe(1);

    wrapper.unmount();
  });

  it("flushes a pending snapshot immediately when the app becomes visible again", async () => {
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });

    const raf = vi.fn(() => 1);
    const cancel = vi.fn(() => {});
    (window as any).requestAnimationFrame = raf;
    (window as any).cancelAnimationFrame = cancel;

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

    capturedSnapshotHandler!({
      payload: {
        snapshotRevision: 2,
        jobs: [
          {
            id: "job-2",
            filename: "b.mp4",
            type: "video",
            source: "manual",
            originalSizeMB: 10,
            presetId: "preset-1",
            status: "processing",
            progress: 66,
          },
        ],
      } satisfies QueueStateLite,
    });

    await nextTick();
    expect(jobs.value).toHaveLength(0);

    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();

    expect(jobs.value).toHaveLength(1);
    expect(jobs.value[0].progress).toBe(66);
    expect(lastQueueSnapshotRevision.value).toBe(2);

    wrapper.unmount();
  });
});
