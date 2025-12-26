// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, computed, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { CompositeBatchCompressTask, FFmpegPreset, QueueStateLite, TranscodeJob } from "@/types";

const loadQueueStateMock = vi.fn<() => Promise<QueueStateLite>>();

let capturedQueueEventHandler: ((event: { payload: QueueStateLite }) => void) | null = null;

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    loadQueueStateLite: () => loadQueueStateMock(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, handler: (event: any) => void) => {
    capturedQueueEventHandler = handler;
    return Promise.resolve(() => {});
  },
}));

import { useMainAppQueue } from "./useMainAppQueue";

function makeEmptyJobs(): TranscodeJob[] {
  return [];
}

describe("useMainAppQueue startup idle defers", () => {
  beforeEach(() => {
    loadQueueStateMock.mockReset();
    capturedQueueEventHandler = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels deferred initial poll when a queue event arrives before idle", async () => {
    loadQueueStateMock.mockResolvedValue({ jobs: [] });

    const startupIdleReady = ref(false);
    const jobs = ref<TranscodeJob[]>(makeEmptyJobs());
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    const TestHarness = defineComponent({
      setup() {
        useMainAppQueue({
          t: (key: string) => key,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
          onJobCompleted: () => {},
          startupIdleReady,
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    // Initial poll must be deferred; no backend call yet.
    expect(loadQueueStateMock).not.toHaveBeenCalled();
    expect(capturedQueueEventHandler).toBeTypeOf("function");

    // Simulate a push-style queue event before idle gate opens.
    const handler = capturedQueueEventHandler!;
    handler({ payload: { jobs: [] } as QueueStateLite });

    // Now open the idle gate; deferred poll should have been cancelled.
    startupIdleReady.value = true;
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadQueueStateMock).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("performs initial poll after startupIdleReady when no event arrives", async () => {
    loadQueueStateMock.mockResolvedValue({ jobs: [] });

    const startupIdleReady = ref(false);
    const jobs = ref<TranscodeJob[]>(makeEmptyJobs());
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    const TestHarness = defineComponent({
      setup() {
        useMainAppQueue({
          t: (key: string) => key,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
          onJobCompleted: () => {},
          startupIdleReady,
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    expect(loadQueueStateMock).not.toHaveBeenCalled();

    // Open the idle gate; this should trigger the deferred initial poll.
    startupIdleReady.value = true;
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadQueueStateMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
