import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, JobStatus, FFmpegPreset, Translate } from "@/types";
import {
  hasTauri,
  enqueueTranscodeJob,
  enqueueTranscodeJobs,
  expandManualJobInputs,
  cancelTranscodeJob,
  waitTranscodeJob,
  resumeTranscodeJob,
  restartTranscodeJob,
} from "@/lib/backend";

/**
 * Single job operation dependencies.
 */
export interface SingleJobOpsDeps {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Job ids that have a pending "wait" request but are still processing. */
  pausingJobIds: Ref<Set<string>>;
  /** The currently selected preset for manual jobs. */
  manualJobPreset: ComputedRef<FFmpegPreset | null>;
  /** All available presets. */
  presets: Ref<FFmpegPreset[]>;
  /** Queue error message ref. */
  queueError: Ref<string | null>;
  /** Optional i18n translation function. */
  t?: Translate;
  /** Refresh queue state from backend. */
  refreshQueueFromBackend: () => Promise<void>;
}

// ----- Single Job Status Operations -----

/**
 * Wait (pause) a processing job.
 * In non-Tauri mode, updates job status locally.
 * In Tauri mode, calls backend and updates UI-only state (no log injection).
 */
export async function handleWaitJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId && (job.status === "processing" || job.status === "queued")
        ? ({
            ...job,
            status: "paused" as JobStatus,
          } as TranscodeJob)
        : job,
    );
    return;
  }

  const existingJob = deps.jobs.value.find((job) => job.id === jobId) ?? null;
  const expectsCooperativePause = existingJob?.status === "processing";

  try {
    if (expectsCooperativePause) {
      deps.pausingJobIds.value = new Set([...deps.pausingJobIds.value, jobId]);
    }
    const ok = await waitTranscodeJob(jobId);
    if (!ok) {
      if (expectsCooperativePause) {
        const next = new Set(deps.pausingJobIds.value);
        next.delete(jobId);
        deps.pausingJobIds.value = next;
      }
      deps.queueError.value = deps.t?.("queue.error.waitRejected") ?? "";
      return;
    }
    if (!expectsCooperativePause) {
      deps.jobs.value = deps.jobs.value.map((job) =>
        job.id === jobId
          ? ({
              ...job,
              status: "paused" as JobStatus,
            } as TranscodeJob)
          : job,
      );
    }
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to wait job", error);
    if (expectsCooperativePause) {
      const next = new Set(deps.pausingJobIds.value);
      next.delete(jobId);
      deps.pausingJobIds.value = next;
    }
    deps.queueError.value = deps.t?.("queue.error.waitFailed") ?? "";
  }
}

/**
 * Resume a paused job.
 * In non-Tauri mode, updates job status locally.
 * In Tauri mode, calls backend and updates status (no log injection).
 */
export async function handleResumeJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId && job.status === "paused"
        ? ({
            ...job,
            status: "queued" as JobStatus,
          } as TranscodeJob)
        : job,
    );
    return;
  }

  try {
    const ok = await resumeTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value = deps.t?.("queue.error.resumeRejected") ?? "";
      const errorText = deps.queueError.value;
      try {
        await deps.refreshQueueFromBackend();
      } catch {
        // Keep original error text; refresh failures are handled inside refreshQueueFromBackend.
      }
      deps.queueError.value = errorText;
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status === "paused") {
        return {
          ...job,
          status: "queued" as JobStatus,
        };
      }
      return job;
    });
    deps.queueError.value = null;
    void deps.refreshQueueFromBackend().catch((error) => {
      console.error("Failed to refresh queue state after resume", error);
    });
  } catch (error) {
    console.error("Failed to resume job", error);
    deps.queueError.value = deps.t?.("queue.error.resumeFailed") ?? "";
    const errorText = deps.queueError.value;
    try {
      await deps.refreshQueueFromBackend();
    } catch {
      // Keep original error text; refresh failures are handled inside refreshQueueFromBackend.
    }
    deps.queueError.value = errorText;
  }
}

/**
 * Restart a job.
 * Resets job status to queued and clears progress/error fields.
 * Applies to any non-completed job (including failed/cancelled), so the next
 * run starts from 0% while keeping the original job id for history.
 */
export async function handleRestartJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId && job.status !== "completed" && job.status !== "skipped"
        ? ({
            ...job,
            status: "queued" as JobStatus,
            progress: 0,
            failureReason: undefined,
            skipReason: undefined,
          } as TranscodeJob)
        : job,
    );
    return;
  }

  try {
    const ok = await restartTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value = deps.t?.("queue.error.restartRejected") ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status !== "completed" && job.status !== "skipped") {
        return {
          ...job,
          status: "queued" as JobStatus,
          progress: 0,
          failureReason: undefined,
          skipReason: undefined,
        };
      }
      return job;
    });
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to restart job", error);
    deps.queueError.value = deps.t?.("queue.error.restartFailed") ?? "";
  }
}

/**
 * Cancel a job.
 * Immediately sets status to cancelled for queued/paused jobs.
 * For processing jobs, updates status immediately after backend accepts the request.
 */
export async function handleCancelJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    return;
  }

  try {
    const ok = await cancelTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value = deps.t?.("queue.error.cancelRejected") ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status === "queued" || job.status === "paused") {
        return { ...job, status: "cancelled" as JobStatus };
      }
      if (job.status === "processing") {
        return {
          ...job,
          status: "cancelled" as JobStatus,
        };
      }
      return job;
    });
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to cancel job", error);
    deps.queueError.value = deps.t?.("queue.error.cancelFailed") ?? "";
  }
}

// ----- Enqueue Methods -----

/**
 * Enqueue manual jobs from a list of input paths (files and/or directories).
 *
 * This expands all inputs in a single backend call and batches the enqueue
 * operation to avoid UI stalls when users drop many files at once.
 */
export async function enqueueManualJobsFromPaths(paths: string[], deps: SingleJobOpsDeps) {
  const normalized = (paths ?? []).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (normalized.length === 0) return;

  if (!hasTauri()) {
    console.error("enqueueManualJobsFromPaths requires Tauri");
    deps.queueError.value = deps.t?.("queue.error.enqueueFailed") ?? "";
    return;
  }

  const preset = deps.manualJobPreset.value ?? deps.presets.value[0];
  if (!preset) {
    console.error("No preset available for manual job");
    deps.queueError.value = deps.t?.("queue.error.enqueueFailed") ?? "";
    return;
  }

  try {
    const expanded = await expandManualJobInputs(normalized, { recursive: true });
    if (!Array.isArray(expanded) || expanded.length === 0) {
      // Nothing to enqueue (e.g. folder has no transcodable files, or inputs
      // contain only non-video files).
      return;
    }

    if (expanded.length === 1) {
      await enqueueTranscodeJob({
        filename: expanded[0],
        jobType: "video",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: preset.id,
      });
    } else {
      await enqueueTranscodeJobs({
        filenames: expanded,
        jobType: "video",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: preset.id,
      });
    }

    // Avoid racing with queue stream events; let backend be the single source of truth.
    await deps.refreshQueueFromBackend();
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to enqueue manual jobs from paths", error);
    deps.queueError.value = deps.t?.("queue.error.enqueueFailed") ?? "";
  }
}

/**
 * Enqueue a manual job from a file path.
 * Backend will compute accurate size and codec metadata based on the actual
 * file on disk.
 * Requires a valid preset; fails gracefully if none available.
 */
export async function enqueueManualJobFromPath(path: string, deps: SingleJobOpsDeps) {
  return enqueueManualJobsFromPaths([path], deps);
}
