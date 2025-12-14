import type { TranscodeJob } from "@/types";

export function isWaitingStatus(status: TranscodeJob["status"]) {
  return status === "waiting" || status === "queued" || status === "paused";
}

export function isTerminalStatus(status: TranscodeJob["status"]) {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "skipped" ||
    status === "cancelled"
  );
}

export function compareJobsInWaitingGroup(
  a: TranscodeJob,
  b: TranscodeJob,
  compareJobsByConfiguredFields: (a: TranscodeJob, b: TranscodeJob) => number,
): number {
  const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;

  let result = compareJobsByConfiguredFields(a, b);
  if (result !== 0) return result;

  const as = a.startTime ?? 0;
  const bs = b.startTime ?? 0;
  if (as !== bs) return as - bs;

  return a.id.localeCompare(b.id);
}

