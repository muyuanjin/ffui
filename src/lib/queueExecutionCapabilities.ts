import type { TranscodeJob } from "@/types";

export const canReplayQueueJob = (job: Pick<TranscodeJob, "executionMode">): boolean =>
  job.executionMode !== "transparent" && job.executionMode !== "invalid";

export const getQueueReplayEligibility = (jobs: ReadonlyArray<Pick<TranscodeJob, "executionMode" | "status">>) => ({
  wait: jobs.some((job) => canReplayQueueJob(job) && (job.status === "queued" || job.status === "processing")),
  resume: jobs.some((job) => canReplayQueueJob(job) && job.status === "paused"),
});

export const hasIndeterminateQueueProgress = (
  job: Pick<TranscodeJob, "executionMode" | "status" | "waitMetadata">,
): boolean => {
  if (job.status !== "processing") return false;
  if (job.executionMode === "transparent") return true;
  if (job.executionMode !== "managed") return false;
  const percent = job.waitMetadata?.lastProgressPercent;
  return typeof percent !== "number" || !Number.isFinite(percent);
};
