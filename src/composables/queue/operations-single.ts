import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, JobStatus, FFmpegPreset } from "@/types";
import {
  hasTauri,
  enqueueTranscodeJob,
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
  t?: (key: string) => string;
  /** Refresh queue state from backend. */
  refreshQueueFromBackend: () => Promise<void>;
}

// ----- Single Job Status Operations -----

/**
 * Wait (pause) a processing job.
 * In non-Tauri mode, updates job status locally.
 * In Tauri mode, calls backend and updates job with logs.
 */
export async function handleWaitJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId && job.status === "processing"
        ? ({
            ...job,
            status: "paused" as JobStatus,
          } as TranscodeJob)
        : job,
    );
    return;
  }

  try {
    deps.pausingJobIds.value = new Set([...deps.pausingJobIds.value, jobId]);
    const ok = await waitTranscodeJob(jobId);
    if (!ok) {
      const next = new Set(deps.pausingJobIds.value);
      next.delete(jobId);
      deps.pausingJobIds.value = next;
      deps.queueError.value =
        (deps.t?.("queue.error.waitRejected") as string) ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status === "processing") {
        const existingLogs = job.logs ?? [];
        return {
          ...job,
          logs: [
            ...existingLogs,
            "Wait requested from UI; job will pause when ffmpeg reaches a safe point",
          ],
        };
      }
      return job;
    });
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to wait job", error);
    const next = new Set(deps.pausingJobIds.value);
    next.delete(jobId);
    deps.pausingJobIds.value = next;
    deps.queueError.value =
      (deps.t?.("queue.error.waitFailed") as string) ?? "";
  }
}

/**
 * Resume a paused job.
 * In non-Tauri mode, updates job status locally.
 * In Tauri mode, calls backend and updates job with logs.
 */
export async function handleResumeJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId && job.status === "paused"
        ? ({
            ...job,
            status: "waiting" as JobStatus,
          } as TranscodeJob)
        : job,
    );
    return;
  }

  try {
    const ok = await resumeTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value =
        (deps.t?.("queue.error.resumeRejected") as string) ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status === "paused") {
        const existingLogs = job.logs ?? [];
        return {
          ...job,
          status: "waiting" as JobStatus,
          logs: [
            ...existingLogs,
            "Resume requested from UI; job re-entered waiting queue",
          ],
        };
      }
      return job;
    });
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to resume job", error);
    deps.queueError.value =
      (deps.t?.("queue.error.resumeFailed") as string) ?? "";
  }
}

/**
 * Restart a job.
 * Resets job status to waiting and clears progress/error fields.
 * Applies to any non-completed job (including failed/cancelled), so the next
 * run starts from 0% while keeping the original job id for history.
 */
export async function handleRestartJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    deps.jobs.value = deps.jobs.value.map((job) =>
      job.id === jobId &&
      job.status !== "completed" &&
      job.status !== "skipped"
        ? ({
            ...job,
            status: "waiting" as JobStatus,
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
      deps.queueError.value =
        (deps.t?.("queue.error.restartRejected") as string) ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status !== "completed" && job.status !== "skipped") {
        return {
          ...job,
          status: "waiting" as JobStatus,
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
    deps.queueError.value =
      (deps.t?.("queue.error.restartFailed") as string) ?? "";
  }
}

/**
 * Cancel a job.
 * Immediately sets status to cancelled for waiting/queued/paused jobs.
 * For processing jobs, logs cancellation request and waits for backend.
 */
export async function handleCancelJob(jobId: string, deps: SingleJobOpsDeps) {
  if (!jobId) return;

  if (!hasTauri()) {
    return;
  }

  try {
    const ok = await cancelTranscodeJob(jobId);
    if (!ok) {
      deps.queueError.value =
        (deps.t?.("queue.error.cancelRejected") as string) ?? "";
      return;
    }

    deps.jobs.value = deps.jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (
        job.status === "waiting" ||
        job.status === "queued" ||
        job.status === "paused"
      ) {
        return { ...job, status: "cancelled" as JobStatus };
      }
      if (job.status === "processing") {
        const existingLogs = job.logs ?? [];
        return {
          ...job,
          status: "cancelled" as JobStatus,
          logs: [
            ...existingLogs,
            "Cancellation requested from UI; waiting for backend to stop ffmpeg",
          ],
        };
      }
      return job;
    });
    deps.queueError.value = null;
  } catch (error) {
    console.error("Failed to cancel job", error);
    deps.queueError.value =
      (deps.t?.("queue.error.cancelFailed") as string) ?? "";
  }
}

// ----- Enqueue Methods -----

/**
 * Add a mock manual job for non-Tauri environments.
 * Uses current manual preset or first available preset.
 */
export function addManualJobMock(deps: Pick<SingleJobOpsDeps, "jobs" | "manualJobPreset" | "presets">) {
  const presetForJob = deps.manualJobPreset.value ?? deps.presets.value[0];
  if (!presetForJob) {
    return;
  }
  const size = Math.floor(Math.random() * 500) + 50;
  const newJob: TranscodeJob = {
    id: Date.now().toString(),
    filename: `manual_job_${Math.floor(Math.random() * 1000)}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: size,
    originalCodec: "h264",
    presetId: presetForJob.id,
    status: "waiting",
    progress: 0,
    logs: [],
  };
  deps.jobs.value = [newJob, ...deps.jobs.value];
}

/**
 * Enqueue a manual job from a file path.
 * Backend will compute accurate size and codec metadata based on the actual
 * file on disk.
 * Requires a valid preset; fails gracefully if none available.
 */
export async function enqueueManualJobFromPath(path: string, deps: SingleJobOpsDeps) {
  if (!hasTauri()) {
    console.error("enqueueManualJobFromPath requires Tauri");
    deps.queueError.value =
      (deps.t?.("queue.error.enqueueFailed") as string) ?? "";
    return;
  }

  const preset = deps.manualJobPreset.value ?? deps.presets.value[0];
  if (!preset) {
    console.error("No preset available for manual job");
    deps.queueError.value =
      (deps.t?.("queue.error.enqueueFailed") as string) ?? "";
    return;
  }

  try {
    const expanded = await expandManualJobInputs([path], { recursive: true });
    if (!Array.isArray(expanded) || expanded.length === 0) {
      // Nothing to enqueue (e.g. dropped a folder with no transcodable files,
      // or dropped a non-video file).
      return;
    }

    for (const filename of expanded) {
      await enqueueTranscodeJob({
        filename,
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
    console.error("Failed to enqueue manual job from path", error);
    deps.queueError.value =
      (deps.t?.("queue.error.enqueueFailed") as string) ?? "";
  }
}
