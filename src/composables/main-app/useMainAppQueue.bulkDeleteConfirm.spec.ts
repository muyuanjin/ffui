// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, computed, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { CompositeBatchCompressTask, FFmpegPreset, TranscodeJob } from "@/types";

const cancelTranscodeJobsBulkMock = vi.fn<(jobIds: string[]) => Promise<boolean>>(async () => true);
const deleteTranscodeJobsBulkMock = vi.fn<(jobIds: string[]) => Promise<boolean>>(async () => true);
const loadQueueStateLiteMock = vi.fn(async () => ({ jobs: [] }));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    cancelTranscodeJobsBulk: (jobIds: string[]) => cancelTranscodeJobsBulkMock(jobIds),
    deleteTranscodeJobsBulk: (jobIds: string[]) => deleteTranscodeJobsBulkMock(jobIds),
    loadQueueStateLite: () => loadQueueStateLiteMock(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("vue-sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

import { useMainAppQueue } from "./useMainAppQueue";

const makeJob = (id: string, status: TranscodeJob["status"]): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 1,
    presetId: "preset-1",
    status,
    progress: 0,
  }) as TranscodeJob;

describe("useMainAppQueue bulk delete confirm", () => {
  beforeEach(() => {
    cancelTranscodeJobsBulkMock.mockReset();
    deleteTranscodeJobsBulkMock.mockReset();
    loadQueueStateLiteMock.mockReset();
  });

  afterEach(() => {});

  it("opens a confirm dialog when selection includes active jobs", async () => {
    const startupIdleReady = ref(false);
    const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued"), makeJob("job-completed", "completed")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(1);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t: (key: string) => key,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
          startupIdleReady,
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-queued", "job-completed"]);
    await api!.bulkDelete();

    expect(api!.queueDeleteConfirmOpen.value).toBe(true);
    expect(api!.queueDeleteConfirmSelectedCount.value).toBe(2);
    expect(api!.queueDeleteConfirmActiveCount.value).toBe(1);
    expect(api!.queueDeleteConfirmTerminalCount.value).toBe(1);
    expect(cancelTranscodeJobsBulkMock).not.toHaveBeenCalled();
    expect(deleteTranscodeJobsBulkMock).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("cancel-and-delete cancels active jobs then deletes terminal jobs (including newly cancelled)", async () => {
    const startupIdleReady = ref(false);
    const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued"), makeJob("job-completed", "completed")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(1);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    cancelTranscodeJobsBulkMock.mockImplementationOnce(async () => {
      setTimeout(() => {
        lastQueueSnapshotRevision.value = (lastQueueSnapshotRevision.value ?? 0) + 1;
      }, 0);
      return true;
    });

    deleteTranscodeJobsBulkMock.mockImplementationOnce(async () => {
      setTimeout(() => {
        lastQueueSnapshotRevision.value = (lastQueueSnapshotRevision.value ?? 0) + 1;
      }, 0);
      return true;
    });

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t: (key: string) => key,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
          startupIdleReady,
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-queued", "job-completed"]);
    await api!.bulkDelete();
    expect(api!.queueDeleteConfirmOpen.value).toBe(true);

    await api!.confirmQueueDeleteCancelAndDelete();

    expect(cancelTranscodeJobsBulkMock).toHaveBeenCalledTimes(1);
    expect(cancelTranscodeJobsBulkMock).toHaveBeenCalledWith(["job-queued"]);

    expect(deleteTranscodeJobsBulkMock).toHaveBeenCalledTimes(1);
    const deleted = deleteTranscodeJobsBulkMock.mock.calls[0]?.[0] ?? [];
    expect(new Set(deleted)).toEqual(new Set(["job-queued", "job-completed"]));

    wrapper.unmount();
  });

  it("delete-terminal-only deletes terminal jobs and keeps active jobs selected", async () => {
    const startupIdleReady = ref(false);
    const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued"), makeJob("job-completed", "completed")]);
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(null);
    const lastQueueSnapshotRevision = ref<number | null>(1);
    const presets = ref<FFmpegPreset[]>([]);
    const manualJobPresetId = ref<string | null>(null);
    const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => []);
    const compositeTasksById = computed<Map<string, CompositeBatchCompressTask>>(() => new Map());

    deleteTranscodeJobsBulkMock.mockImplementationOnce(async () => {
      setTimeout(() => {
        lastQueueSnapshotRevision.value = (lastQueueSnapshotRevision.value ?? 0) + 1;
      }, 0);
      return true;
    });

    let api: ReturnType<typeof useMainAppQueue> | null = null;
    const TestHarness = defineComponent({
      setup() {
        api = useMainAppQueue({
          t: (key: string) => key,
          jobs,
          queueError,
          lastQueueSnapshotAtMs,
          lastQueueSnapshotRevision,
          presets,
          manualJobPresetId,
          compositeBatchCompressTasks,
          compositeTasksById,
          startupIdleReady,
        });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await nextTick();

    api!.selectedJobIds.value = new Set(["job-queued", "job-completed"]);
    await api!.bulkDelete();
    expect(api!.queueDeleteConfirmOpen.value).toBe(true);

    await api!.confirmQueueDeleteTerminalOnly();

    expect(cancelTranscodeJobsBulkMock).not.toHaveBeenCalled();
    expect(deleteTranscodeJobsBulkMock).toHaveBeenCalledTimes(1);
    expect(deleteTranscodeJobsBulkMock).toHaveBeenCalledWith(["job-completed"]);

    expect(api!.selectedJobIds.value).toEqual(new Set(["job-queued"]));

    wrapper.unmount();
  });
});
