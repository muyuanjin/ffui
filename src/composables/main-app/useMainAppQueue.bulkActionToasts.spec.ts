// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, ref, computed, nextTick } from "vue";
import type { CompositeBatchCompressTask, FFmpegPreset, TranscodeJob, Translate } from "@/types";

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("vue-sonner", () => ({
  toast: {
    info: toastMocks.info,
    success: toastMocks.success,
    error: toastMocks.error,
  },
}));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
  };
});

import { useMainAppQueue } from "./useMainAppQueue";
import { mount } from "@vue/test-utils";

const makeJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/${id}.mp4`,
  type: "video",
  source: "manual",
  originalSizeMB: 1,
  presetId: "preset-1",
  status,
  progress: 0,
});

const t: Translate = (key, params) => {
  if (!params) return key;
  const parts = Object.entries(params)
    .slice()
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${key}:${parts.join(",")}`;
};

describe.skip("useMainAppQueue bulk action toasts", () => {
  beforeEach(() => {
    toastMocks.info.mockReset();
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  it("shows a success toast for bulkWait with queued/processing counts", async () => {
    const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued"), makeJob("job-paused", "paused")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-queued", "job-paused"]);
    await api!.bulkWait();

    expect(toastMocks.success).toHaveBeenCalledTimes(1);
    const [title, opts] = toastMocks.success.mock.calls[0] ?? [];
    expect(title).toBe("queue.feedback.bulkWait.successTitle");
    expect(opts?.description).toContain("queued=1");
    expect(opts?.description).toContain("processing=0");
    expect(opts?.description).toContain("ignored=1");
    expect(toastMocks.info).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("shows a noop toast for bulkWait when nothing is eligible", async () => {
    const jobs = ref<TranscodeJob[]>([makeJob("job-paused", "paused")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-paused"]);
    await api!.bulkWait();

    expect(toastMocks.info).toHaveBeenCalledTimes(1);
    const [title] = toastMocks.info.mock.calls[0] ?? [];
    expect(title).toBe("queue.feedback.bulkWait.noneTitle");
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("shows a success toast for bulkResume with resumed/ignored counts", async () => {
    const jobs = ref<TranscodeJob[]>([makeJob("job-paused", "paused"), makeJob("job-queued", "queued")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-paused", "job-queued"]);
    await api!.bulkResume();

    expect(toastMocks.success).toHaveBeenCalledTimes(1);
    const [title, opts] = toastMocks.success.mock.calls[0] ?? [];
    expect(title).toBe("queue.feedback.bulkResume.successTitle");
    expect(opts?.description).toContain("count=1");
    expect(opts?.description).toContain("ignored=1");
  });

  it("shows a success toast for bulkCancel with cancelled/ignored counts", async () => {
    const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued"), makeJob("job-completed", "completed")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-queued", "job-completed"]);
    await api!.bulkCancel();

    expect(toastMocks.success).toHaveBeenCalledTimes(1);
    const [title, opts] = toastMocks.success.mock.calls[0] ?? [];
    expect(title).toBe("queue.feedback.bulkCancel.successTitle");
    expect(opts?.description).toContain("count=1");
    expect(opts?.description).toContain("ignored=1");
  });
});
