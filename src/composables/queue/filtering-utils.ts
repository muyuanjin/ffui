import type { TranscodeJob } from "@/types";
import type {
  QueueSortDirection,
  QueueSortField,
} from "./useQueueFiltering.types";

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
      return job.status;
    case "addedTime":
      // For now we treat startTime as the "added to queue" timestamp.
      return job.startTime ?? null;
    case "finishedTime":
      return job.endTime ?? null;
    case "duration":
      return job.mediaInfo?.durationSeconds ?? null;
    case "elapsed":
      if (job.startTime && job.endTime && job.endTime > job.startTime) {
        return job.endTime - job.startTime;
      }
      return null;
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
    case "modifiedTime":
      // Filesystem timestamps are not yet tracked; keep these as stable
      // placeholders so sort configs remain forward-compatible.
      return null;
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
  let result = comparePrimitive(av, bv);
  if (direction === "desc") {
    result = -result;
  }
  return result;
};
