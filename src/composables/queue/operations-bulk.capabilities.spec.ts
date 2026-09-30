import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob } from "@/types";
import { bulkWaitSelectedJobs, bulkResumeSelectedJobs } from "./operations-bulk";

const backend = vi.hoisted(() => ({ wait: vi.fn(), resume: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  waitTranscodeJobsBulk: backend.wait,
  resumeTranscodeJobsBulk: backend.resume,
  cancelTranscodeJobsBulk: vi.fn(),
  restartTranscodeJobsBulk: vi.fn(),
  reorderQueue: vi.fn(),
}));

function setup(status: TranscodeJob["status"], modes: TranscodeJob["executionMode"][]) {
  const jobs = ref<TranscodeJob[]>(
    modes.map((executionMode, index) => ({
      id: `job-${index}`,
      filename: "command",
      type: "other",
      source: "manual",
      originalSizeMB: 0,
      presetId: "snapshot",
      progress: 0,
      status,
      executionMode,
    })),
  );
  const selectedJobIds = ref(new Set(jobs.value.map((job) => job.id)));
  return {
    jobs,
    selectedJobIds,
    selectedJobs: computed(() => jobs.value),
    queueError: ref<string | null>(null),
    refreshQueueFromBackend: vi.fn(async () => {}),
    handleCancelJob: vi.fn(),
    handleWaitJob: vi.fn(),
    handleResumeJob: vi.fn(),
    handleRestartJob: vi.fn(),
  };
}

describe("bulk replay capability boundary", () => {
  beforeEach(() => {
    backend.wait.mockReset().mockResolvedValue(true);
    backend.resume.mockReset().mockResolvedValue(true);
  });

  it("does not send transparent or invalid jobs to bulk wait or resume", async () => {
    const deps = setup("queued", ["transparent", "invalid"]);
    await bulkWaitSelectedJobs(deps);
    deps.jobs.value = deps.jobs.value.map((job) => ({ ...job, status: "paused" }));
    await bulkResumeSelectedJobs(deps);
    expect(backend.wait).not.toHaveBeenCalled();
    expect(backend.resume).not.toHaveBeenCalled();
    expect(deps.refreshQueueFromBackend).not.toHaveBeenCalled();
  });

  it("filters mixed requests and never treats a true bulk response as a per-job acknowledgement", async () => {
    const deps = setup("paused", ["transparent", "managed", "video", "invalid"]);
    await bulkResumeSelectedJobs(deps);
    expect(backend.resume).toHaveBeenCalledWith(["job-1", "job-2"]);
    expect(deps.jobs.value.map((job) => job.status)).toEqual(["paused", "paused", "paused", "paused"]);
    expect(deps.refreshQueueFromBackend).toHaveBeenCalledOnce();
    deps.jobs.value = deps.jobs.value.map((job) => ({ ...job, status: "queued" }));
    await bulkWaitSelectedJobs(deps);
    expect(backend.wait).toHaveBeenCalledWith(["job-1", "job-2"]);
  });

  it("uses the refreshed backend state for a mixed resume", async () => {
    const deps = setup("paused", ["transparent", "managed"]);
    deps.refreshQueueFromBackend.mockImplementation(async () => {
      deps.jobs.value = deps.jobs.value.map((job) =>
        job.executionMode === "managed" ? { ...job, status: "processing" } : job,
      );
    });
    await bulkResumeSelectedJobs(deps);
    expect(deps.jobs.value.map((job) => job.status)).toEqual(["paused", "processing"]);
  });
});
