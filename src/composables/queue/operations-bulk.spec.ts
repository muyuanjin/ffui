import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob } from "@/types";
import { bulkResumeSelectedJobs, bulkWaitSelectedJobs } from "./operations-bulk";

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

describe("bulkWaitSelectedJobs", () => {
  it("pauses selected processing/waiting/queued jobs", async () => {
    const jobs = ref<TranscodeJob[]>([
      makeJob("job-processing", "processing"),
      makeJob("job-waiting", "waiting"),
      makeJob("job-queued", "queued"),
      makeJob("job-paused", "paused"),
      makeJob("job-completed", "completed"),
    ]);

    const selectedJobIds = ref(new Set(jobs.value.map((j) => j.id)));
    const selectedJobs = computed(() => jobs.value.filter((j) => selectedJobIds.value.has(j.id)));

    const handleWaitJob = vi.fn(async (_jobId: string) => {});

    await bulkWaitSelectedJobs({
      jobs,
      selectedJobIds,
      selectedJobs,
      queueError: ref(null),
      refreshQueueFromBackend: async () => {},
      handleCancelJob: async () => {},
      handleWaitJob,
      handleResumeJob: async () => {},
      handleRestartJob: async () => {},
    });

    expect(handleWaitJob.mock.calls.map((call) => call[0])).toEqual(["job-processing", "job-waiting", "job-queued"]);
  });
});

describe("bulkResumeSelectedJobs", () => {
  it("resumes selected paused jobs in queue order", async () => {
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
      queueError: ref(null),
      refreshQueueFromBackend: async () => {},
      handleCancelJob: async () => {},
      handleWaitJob: async () => {},
      handleResumeJob,
      handleRestartJob: async () => {},
    });

    expect(handleResumeJob.mock.calls.map((call) => call[0])).toEqual([
      "job-paused-1",
      "job-paused-2",
      "job-paused-no-order",
    ]);
  });
});
