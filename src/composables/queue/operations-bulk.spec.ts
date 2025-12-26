import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob } from "@/types";
import { bulkWaitSelectedJobs } from "./operations-bulk";

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
