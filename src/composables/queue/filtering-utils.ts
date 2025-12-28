import type { TranscodeJob } from "@/types";
import type { QueueSortDirection, QueueSortField } from "./useQueueFiltering.types";

const STATUS_SORT_RANK: Record<TranscodeJob["status"], number> = {
  processing: 0,
  queued: 1,
  paused: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
  skipped: 6,
};

// ----- Helper Functions -----

/**
 * Compare two primitive values for sorting.
 */
export const comparePrimitive = (
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === "string" && typeof b === "string") {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al < bl) return -1;
    if (al > bl) return 1;
    return 0;
  }

  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
};

/**
 * Get the sortable value for a job by field.
 */
export const getJobSortValue = (job: TranscodeJob, field: QueueSortField) => {
  switch (field) {
    case "filename": {
      const raw = job.inputPath || job.filename || "";
      const normalized = raw.replace(/\\/g, "/");
      const lastSlash = normalized.lastIndexOf("/");
      const name = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
      return name || null;
    }
    case "status":
      // Status should follow the UX order (same as the filter buttons), not lexicographic order.
      return STATUS_SORT_RANK[job.status] ?? null;
    case "addedTime":
      // For now we treat startTime as the "added to queue" timestamp.
      return job.startTime ?? null;
    case "finishedTime":
      return job.endTime ?? null;
    case "duration":
      return job.mediaInfo?.durationSeconds ?? null;
    case "elapsed": {
      // "Processing elapsed" should represent actual processing time, not queue wait time.
      if (typeof job.elapsedMs === "number") {
        return job.elapsedMs;
      }
      const baseline = job.processingStartedMs ?? job.startTime;
      if (baseline != null && job.endTime != null && job.endTime > baseline) {
        return job.endTime - baseline;
      }
      return null;
    }
    case "progress":
      return typeof job.progress === "number" ? job.progress : null;
    case "type":
      return job.type;
    case "path":
      return job.inputPath || job.filename || null;
    case "inputSize":
      return job.originalSizeMB ?? null;
    case "outputSize":
      return job.outputSizeMB ?? null;
    case "createdTime":
      return job.createdTimeMs ?? null;
    case "modifiedTime":
      return job.modifiedTimeMs ?? null;
    default:
      return null;
  }
};

/**
 * Compare two jobs by a specific field and direction.
 */
export const compareJobsByField = (
  a: TranscodeJob,
  b: TranscodeJob,
  field: QueueSortField,
  direction: QueueSortDirection,
): number => {
  const av = getJobSortValue(a, field);
  const bv = getJobSortValue(b, field);
  // Always keep null/undefined values at the bottom, regardless of sort direction.
  // This prevents unfinished/unknown values (e.g. finishedTime) from bubbling to the top on "desc".
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  let result = comparePrimitive(av, bv);
  if (direction === "desc") {
    result = -result;
  }
  return result;
};
