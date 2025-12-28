import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";

const makeJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/${id}.mp4`,
  type: "video",
  source: "manual",
  originalSizeMB: 1,
  presetId: "preset-1",
  status,
  progress: 0,
  logs: [],
});

async function withTauriBackendMock<T>(
  fn: (deps: {
    handleWaitJob: typeof import("./operations-single").handleWaitJob;
    handleResumeJob: typeof import("./operations-single").handleResumeJob;
    handleRestartJob: typeof import("./operations-single").handleRestartJob;
    handleCancelJob: typeof import("./operations-single").handleCancelJob;
    waitMock: any;
    resumeMock: any;
    restartMock: any;
    cancelMock: any;
  }) => T,
): Promise<T> {
  await vi.resetModules();

  const waitMock = vi.fn();
  const resumeMock = vi.fn();
  const restartMock = vi.fn();
  const cancelMock = vi.fn();
  vi.doMock("@/lib/backend", () => ({
    hasTauri: () => true,
    waitTranscodeJob: (...args: any[]) => waitMock(...args),
    resumeTranscodeJob: (...args: any[]) => resumeMock(...args),
    restartTranscodeJob: (...args: any[]) => restartMock(...args),
    cancelTranscodeJob: (...args: any[]) => cancelMock(...args),
    enqueueTranscodeJob: async () => ({}),
    enqueueTranscodeJobs: async () => [],
    expandManualJobInputs: async () => [],
  }));

  const { handleWaitJob, handleResumeJob, handleRestartJob, handleCancelJob } = await import("./operations-single");

  try {
    return fn({
      handleWaitJob,
      handleResumeJob,
      handleRestartJob,
      handleCancelJob,
      waitMock,
      resumeMock,
      restartMock,
      cancelMock,
    });
  } finally {
    vi.doUnmock("@/lib/backend");
    await vi.resetModules();
  }
}

describe("handleWaitJob (tauri)", () => {
  it("does not force queued jobs into paused locally (prevents status/progress desync races)", async () => {
    await withTauriBackendMock(async ({ handleWaitJob, waitMock }) => {
      waitMock.mockResolvedValueOnce(true);

      const jobs = ref<TranscodeJob[]>([makeJob("job-queued", "queued")]);
      const refreshQueueFromBackend = vi.fn(async () => {});

      await handleWaitJob("job-queued", {
        jobs,
        manualJobPreset: computed<FFmpegPreset | null>(() => null),
        presets: ref([]),
        queueError: ref(null),
        t: undefined,
        refreshQueueFromBackend,
      });

      expect(waitMock).toHaveBeenCalledWith("job-queued");
      expect(jobs.value[0]?.status).toBe("queued");
      expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
    });
  });
});

describe("handleResumeJob / handleRestartJob / handleCancelJob (tauri)", () => {
  it("mutates existing job objects in place (prevents virtual list stale references)", async () => {
    await withTauriBackendMock(
      async ({ handleResumeJob, handleRestartJob, handleCancelJob, resumeMock, restartMock, cancelMock }) => {
        resumeMock.mockResolvedValueOnce(true);
        restartMock.mockResolvedValueOnce(true);
        cancelMock.mockResolvedValueOnce(true);

        const jobPaused = makeJob("job-paused", "paused");
        const jobProcessing = makeJob("job-processing", "processing");
        const jobs = ref<TranscodeJob[]>([jobPaused, jobProcessing]);
        const pausedRef = jobs.value[0]!;
        const processingRef = jobs.value[1]!;
        const refreshQueueFromBackend = vi.fn(async () => {});

        await handleResumeJob("job-paused", {
          jobs,
          manualJobPreset: computed<FFmpegPreset | null>(() => null),
          presets: ref([]),
          queueError: ref(null),
          t: undefined,
          refreshQueueFromBackend,
        });
        expect(resumeMock).toHaveBeenCalledWith("job-paused");
        expect(jobs.value[0]).toBe(pausedRef);
        expect(jobs.value[0]?.status).toBe("queued");

        await handleRestartJob("job-processing", {
          jobs,
          manualJobPreset: computed<FFmpegPreset | null>(() => null),
          presets: ref([]),
          queueError: ref(null),
          t: undefined,
          refreshQueueFromBackend,
        });
        expect(restartMock).toHaveBeenCalledWith("job-processing");
        expect(jobs.value[1]).toBe(processingRef);
        expect(jobs.value[1]?.status).toBe("queued");
        expect(jobs.value[1]?.progress).toBe(0);

        await handleCancelJob("job-processing", {
          jobs,
          manualJobPreset: computed<FFmpegPreset | null>(() => null),
          presets: ref([]),
          queueError: ref(null),
          t: undefined,
          refreshQueueFromBackend,
        });
        expect(cancelMock).toHaveBeenCalledWith("job-processing");
        expect(jobs.value[1]).toBe(processingRef);
        expect(jobs.value[1]?.status).toBe("cancelled");
      },
    );
  });
});
