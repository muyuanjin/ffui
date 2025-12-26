import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob } from "@/types";

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

async function withTauriBackendMock<T>(
  fn: (deps: { bulkWaitSelectedJobs: typeof import("./operations-bulk").bulkWaitSelectedJobs; waitMock: any }) => T,
): Promise<T> {
  await vi.resetModules();

  const waitMock = vi.fn();
  vi.doMock("@/lib/backend", () => ({
    hasTauri: () => true,
    reorderQueue: async () => true,
    waitTranscodeJobsBulk: (...args: any[]) => waitMock(...args),
  }));

  const { bulkWaitSelectedJobs } = await import("./operations-bulk");

  try {
    return fn({ bulkWaitSelectedJobs, waitMock });
  } finally {
    vi.doUnmock("@/lib/backend");
    await vi.resetModules();
  }
}

describe("bulkWaitSelectedJobs (tauri)", () => {
  it("uses a single backend bulk wait call and does not start queued jobs", async () => {
    await withTauriBackendMock(async ({ bulkWaitSelectedJobs, waitMock }) => {
      waitMock.mockResolvedValueOnce(true);

      const jobs = ref<TranscodeJob[]>([
        makeJob("job-processing", "processing"),
        makeJob("job-waiting", "queued"),
        makeJob("job-queued", "queued"),
      ]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));
      const pausingJobIds = ref(new Set<string>());

      const handleWaitJob = vi.fn(async (_jobId: string) => {});

      await bulkWaitSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds,
        queueError: ref(null),
        refreshQueueFromBackend: async () => {},
        handleCancelJob: async () => {},
        handleWaitJob,
        handleResumeJob: async () => {},
        handleRestartJob: async () => {},
      });

      expect(handleWaitJob).not.toHaveBeenCalled();
      expect(waitMock).toHaveBeenCalledTimes(1);
      expect(waitMock).toHaveBeenCalledWith(["job-processing", "job-waiting", "job-queued"]);

      const statusById = new Map(jobs.value.map((j) => [j.id, j.status]));
      expect(statusById.get("job-processing")).toBe("processing");
      expect(statusById.get("job-waiting")).toBe("paused");
      expect(statusById.get("job-queued")).toBe("paused");

      expect(pausingJobIds.value.has("job-processing")).toBe(true);
    });
  });

  it("rolls back optimistic state when backend rejects", async () => {
    await withTauriBackendMock(async ({ bulkWaitSelectedJobs, waitMock }) => {
      waitMock.mockResolvedValueOnce(false);

      const jobs = ref<TranscodeJob[]>([
        makeJob("job-processing", "processing"),
        makeJob("job-waiting", "queued"),
        makeJob("job-queued", "queued"),
      ]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));
      const pausingJobIds = ref(new Set<string>(["some-other-job"]));

      await bulkWaitSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds,
        queueError: ref(null),
        refreshQueueFromBackend: async () => {},
        handleCancelJob: async () => {},
        handleWaitJob: async () => {},
        handleResumeJob: async () => {},
        handleRestartJob: async () => {},
        t: (key: string) => key,
      });

      const statusById = new Map(jobs.value.map((j) => [j.id, j.status]));
      expect(statusById.get("job-processing")).toBe("processing");
      expect(statusById.get("job-waiting")).toBe("queued");
      expect(statusById.get("job-queued")).toBe("queued");
      expect(pausingJobIds.value).toEqual(new Set(["some-other-job"]));
    });
  });
});
