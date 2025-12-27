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
  fn: (deps: {
    bulkWaitSelectedJobs: typeof import("./operations-bulk").bulkWaitSelectedJobs;
    bulkCancelSelectedJobs: typeof import("./operations-bulk").bulkCancelSelectedJobs;
    bulkResumeSelectedJobs: typeof import("./operations-bulk").bulkResumeSelectedJobs;
    bulkRestartSelectedJobs: typeof import("./operations-bulk").bulkRestartSelectedJobs;
    waitMock: any;
    cancelMock: any;
    resumeMock: any;
    restartMock: any;
  }) => T,
): Promise<T> {
  await vi.resetModules();

  const waitMock = vi.fn();
  const cancelMock = vi.fn();
  const resumeMock = vi.fn();
  const restartMock = vi.fn();
  vi.doMock("@/lib/backend", () => ({
    hasTauri: () => true,
    reorderQueue: async () => true,
    waitTranscodeJobsBulk: (...args: any[]) => waitMock(...args),
    cancelTranscodeJobsBulk: (...args: any[]) => cancelMock(...args),
    resumeTranscodeJobsBulk: (...args: any[]) => resumeMock(...args),
    restartTranscodeJobsBulk: (...args: any[]) => restartMock(...args),
  }));

  const { bulkWaitSelectedJobs, bulkCancelSelectedJobs, bulkResumeSelectedJobs, bulkRestartSelectedJobs } =
    await import("./operations-bulk");

  try {
    return fn({
      bulkWaitSelectedJobs,
      bulkCancelSelectedJobs,
      bulkResumeSelectedJobs,
      bulkRestartSelectedJobs,
      waitMock,
      cancelMock,
      resumeMock,
      restartMock,
    });
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

  it("syncs queue snapshot revision and does not surface refresh errors as bulk failure", async () => {
    await vi.resetModules();

    const waitMock = vi.fn().mockResolvedValueOnce(true);
    const waitForRevisionMock = vi.fn().mockResolvedValueOnce(false);

    vi.doMock("@/lib/backend", () => ({
      hasTauri: () => true,
      reorderQueue: async () => true,
      waitTranscodeJobsBulk: (...args: any[]) => waitMock(...args),
      cancelTranscodeJobsBulk: async () => true,
      resumeTranscodeJobsBulk: async () => true,
      restartTranscodeJobsBulk: async () => true,
    }));

    vi.doMock("./waitForQueueUpdate", () => ({
      waitForQueueSnapshotRevision: (...args: any[]) => waitForRevisionMock(...args),
    }));

    const { bulkWaitSelectedJobs } = await import("./operations-bulk");

    try {
      const jobs = ref<TranscodeJob[]>([makeJob("job-processing", "processing"), makeJob("job-queued", "queued")]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));
      const pausingJobIds = ref(new Set<string>());
      const lastQueueSnapshotRevision = ref<number | null>(123);
      const queueError = ref<string | null>(null);

      const refreshQueueFromBackend = vi.fn(async () => {
        throw new Error("refresh failed");
      });

      await bulkWaitSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds,
        queueError,
        lastQueueSnapshotRevision,
        refreshQueueFromBackend,
        handleCancelJob: async () => {},
        handleWaitJob: async () => {},
        handleResumeJob: async () => {},
        handleRestartJob: async () => {},
        t: (key: string) => key,
      });

      expect(waitForRevisionMock).toHaveBeenCalledTimes(1);
      expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
      expect(queueError.value).toBeNull();
    } finally {
      vi.doUnmock("@/lib/backend");
      vi.doUnmock("./waitForQueueUpdate");
      await vi.resetModules();
    }
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

describe("bulkCancelSelectedJobs (tauri)", () => {
  it("uses a single backend bulk cancel call", async () => {
    await withTauriBackendMock(async ({ bulkCancelSelectedJobs, cancelMock }) => {
      cancelMock.mockResolvedValueOnce(true);

      const jobs = ref<TranscodeJob[]>([
        makeJob("job-processing", "processing"),
        makeJob("job-queued", "queued"),
        makeJob("job-paused", "paused"),
        makeJob("job-completed", "completed"),
      ]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));

      const handleCancelJob = vi.fn(async (_jobId: string) => {});

      await bulkCancelSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds: ref(new Set()),
        queueError: ref(null),
        refreshQueueFromBackend: async () => {},
        handleCancelJob,
        handleWaitJob: async () => {},
        handleResumeJob: async () => {},
        handleRestartJob: async () => {},
      });

      expect(handleCancelJob).not.toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith(["job-processing", "job-queued", "job-paused"]);

      const statusById = new Map(jobs.value.map((j) => [j.id, j.status]));
      expect(statusById.get("job-processing")).toBe("cancelled");
      expect(statusById.get("job-queued")).toBe("cancelled");
      expect(statusById.get("job-paused")).toBe("cancelled");
      expect(statusById.get("job-completed")).toBe("completed");
    });
  });
});

describe("bulkResumeSelectedJobs (tauri)", () => {
  it("uses a single backend bulk resume call with stable ordering", async () => {
    await withTauriBackendMock(async ({ bulkResumeSelectedJobs, resumeMock }) => {
      resumeMock.mockResolvedValueOnce(true);

      const jobs = ref<TranscodeJob[]>([
        { ...makeJob("job-paused-2", "paused"), queueOrder: 2 },
        { ...makeJob("job-paused-1", "paused"), queueOrder: 1 },
        { ...makeJob("job-paused-no-order", "paused"), queueOrder: undefined },
        makeJob("job-processing", "processing"),
      ]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));

      const handleResumeJob = vi.fn(async (_jobId: string) => {});

      await bulkResumeSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds: ref(new Set()),
        queueError: ref(null),
        refreshQueueFromBackend: async () => {},
        handleCancelJob: async () => {},
        handleWaitJob: async () => {},
        handleResumeJob,
        handleRestartJob: async () => {},
      });

      expect(handleResumeJob).not.toHaveBeenCalled();
      expect(resumeMock).toHaveBeenCalledTimes(1);
      expect(resumeMock).toHaveBeenCalledWith(["job-paused-1", "job-paused-2", "job-paused-no-order"]);

      const statusById = new Map(jobs.value.map((j) => [j.id, j.status]));
      expect(statusById.get("job-paused-1")).toBe("queued");
      expect(statusById.get("job-paused-2")).toBe("queued");
      expect(statusById.get("job-paused-no-order")).toBe("queued");
    });
  });
});

describe("bulkRestartSelectedJobs (tauri)", () => {
  it("uses a single backend bulk restart call and updates UI state", async () => {
    await withTauriBackendMock(async ({ bulkRestartSelectedJobs, restartMock }) => {
      restartMock.mockResolvedValueOnce(true);

      const jobs = ref<TranscodeJob[]>([
        makeJob("job-processing", "processing"),
        makeJob("job-failed", "failed"),
        makeJob("job-cancelled", "cancelled"),
        makeJob("job-completed", "completed"),
        makeJob("job-skipped", "skipped"),
      ]);

      const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
      const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));

      const handleRestartJob = vi.fn(async (_jobId: string) => {});

      await bulkRestartSelectedJobs({
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds: ref(new Set()),
        queueError: ref(null),
        refreshQueueFromBackend: async () => {},
        handleCancelJob: async () => {},
        handleWaitJob: async () => {},
        handleResumeJob: async () => {},
        handleRestartJob,
      });

      expect(handleRestartJob).not.toHaveBeenCalled();
      expect(restartMock).toHaveBeenCalledTimes(1);
      expect(restartMock).toHaveBeenCalledWith(["job-processing", "job-failed", "job-cancelled"]);

      const statusById = new Map(jobs.value.map((j) => [j.id, j.status]));
      expect(statusById.get("job-processing")).toBe("queued");
      expect(statusById.get("job-failed")).toBe("queued");
      expect(statusById.get("job-cancelled")).toBe("queued");
      expect(statusById.get("job-completed")).toBe("completed");
      expect(statusById.get("job-skipped")).toBe("skipped");
    });
  });
});

describe("reorderWaitingQueue (tauri)", () => {
  it("waits for the next snapshot revision and skips redundant refresh", async () => {
    await vi.resetModules();

    const jobs = ref<TranscodeJob[]>([makeJob("waiting-a", "queued"), makeJob("waiting-b", "queued")]);
    const selectedJobIds = ref(new Set<string>());
    const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));
    const pausingJobIds = ref(new Set<string>());
    const queueError = ref<string | null>(null);
    const lastQueueSnapshotAtMs = ref<number | null>(1000);
    const lastQueueSnapshotRevision = ref<number | null>(1);

    const refreshQueueFromBackend = vi.fn(async () => {});

    const reorderMock = vi.fn(async (_orderedIds: string[]) => {
      setTimeout(() => {
        lastQueueSnapshotRevision.value = (lastQueueSnapshotRevision.value ?? 0) + 1;
        lastQueueSnapshotAtMs.value = Date.now();
      }, 0);
      return true;
    });

    vi.doMock("@/lib/backend", () => ({
      hasTauri: () => true,
      reorderQueue: reorderMock,
      waitTranscodeJobsBulk: async () => true,
      cancelTranscodeJobsBulk: async () => true,
      resumeTranscodeJobsBulk: async () => true,
      restartTranscodeJobsBulk: async () => true,
    }));

    try {
      const { reorderWaitingQueue } = await import("./operations-bulk");

      await reorderWaitingQueue(["waiting-b", "waiting-a"], {
        jobs,
        selectedJobIds,
        selectedJobs,
        pausingJobIds,
        queueError,
        lastQueueSnapshotAtMs,
        lastQueueSnapshotRevision,
        refreshQueueFromBackend,
        handleCancelJob: async () => {},
        handleWaitJob: async () => {},
        handleResumeJob: async () => {},
        handleRestartJob: async () => {},
      });

      expect(reorderMock).toHaveBeenCalledTimes(1);
      expect(refreshQueueFromBackend).not.toHaveBeenCalled();
      expect(queueError.value).toBeNull();
    } finally {
      vi.doUnmock("@/lib/backend");
      await vi.resetModules();
    }
  });
});
