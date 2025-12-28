import type { TranscodeJob } from "@/types";

export type UiJobStatus = TranscodeJob["status"] | "pausing";

export const isWaitRequestPending = (job: TranscodeJob): boolean => {
  return job.status === "processing" && job.waitRequestPending === true;
};

export const resolveUiJobStatus = (job: TranscodeJob): UiJobStatus => {
  return isWaitRequestPending(job) ? "pausing" : job.status;
};
