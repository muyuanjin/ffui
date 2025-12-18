import type { JobStatus, TranscodeJob } from "@/types";

export const isJobCompareStatusEligible = (status: JobStatus | undefined | null) => {
  return status === "processing" || status === "paused" || status === "completed";
};

export const isJobCompareEligible = (job: TranscodeJob | null | undefined) => {
  if (!job) return false;
  if (job.type !== "video") return false;
  return isJobCompareStatusEligible(job.status);
};

export const getJobCompareDisabledReason = (job: TranscodeJob | null | undefined): string | null => {
  if (!job) return "no-job";
  if (job.type !== "video") return "not-video";
  if (!isJobCompareStatusEligible(job.status)) return "status";

  if (job.status === "completed") {
    if (!job.outputPath) return "no-output";
  } else {
    const hasSegments = (job.waitMetadata?.segments?.length ?? 0) > 0;
    const hasTmp = !!job.waitMetadata?.tmpOutputPath;
    if (!hasSegments && !hasTmp) return "no-partial-output";
  }

  return null;
};
