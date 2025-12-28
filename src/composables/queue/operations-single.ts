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
 * In Tauri mode, calls backend and relies on backend snapshots for UI state.
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

  try {
    const ok = await waitTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value = deps.t?.("queue.error.waitRejected") ?? "";
      return;
    }
    deps.queueError.value = null;
    // Backend is the single source of truth. Refresh to collapse any UI/backend
    // race where a queued job starts processing while a wait request is in flight.
    void deps.refreshQueueFromBackend().catch((error) => {
      console.error("Failed to refresh queue state after wait", error);
    });
  } catch (error) {
    console.error("Failed to wait job", error);
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

    const job = deps.jobs.value.find((j) => j.id === jobId);
    if (job && job.status === "paused") {
      job.status = "queued";
    }
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

    const job = deps.jobs.value.find((j) => j.id === jobId);
    if (job && job.status !== "completed" && job.status !== "skipped") {
      job.status = "queued";
      job.progress = 0;
      job.failureReason = undefined;
      job.skipReason = undefined;
    }
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

    const job = deps.jobs.value.find((j) => j.id === jobId);
    if (job && (job.status === "queued" || job.status === "paused" || job.status === "processing")) {
      job.status = "cancelled";
    }
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
