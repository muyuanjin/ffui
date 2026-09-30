import type { TranscodeJob } from "@/types";

export const canReplayQueueJob = (job: Pick<TranscodeJob, "executionMode">): boolean =>
  job.executionMode !== "transparent" && job.executionMode !== "invalid";

export const getQueueReplayEligibility = (jobs: ReadonlyArray<Pick<TranscodeJob, "executionMode" | "status">>) => ({
  wait: jobs.some((job) => canReplayQueueJob(job) && (job.status === "queued" || job.status === "processing")),
  resume: jobs.some((job) => canReplayQueueJob(job) && job.status === "paused"),
});

export const hasIndeterminateQueueProgress = (job: Pick<TranscodeJob, "executionMode" | "status">): boolean =>
  job.status === "processing" && (job.executionMode === "managed" || job.executionMode === "transparent");
