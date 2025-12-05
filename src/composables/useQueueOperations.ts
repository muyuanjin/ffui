import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, JobStatus, FFmpegPreset, QueueState } from "@/types";
import {
  hasTauri,
  loadQueueState,
  enqueueTranscodeJob,
  cancelTranscodeJob,
  waitTranscodeJob,
  resumeTranscodeJob,
  restartTranscodeJob,
  reorderQueue,
} from "@/lib/backend";

// ----- Composable -----

export interface UseQueueOperationsOptions {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Smart scan jobs to merge with backend jobs. */
  smartScanJobs: Ref<TranscodeJob[]>;
  /** The currently selected preset for manual jobs. */
  manualJobPreset: ComputedRef<FFmpegPreset | null>;
  /** All available presets. */
  presets: Ref<FFmpegPreset[]>;
  /** Queue error message ref. */
  queueError: Ref<string | null>;
  /** Selected job IDs for bulk operations. */
  selectedJobIds: Ref<Set<string>>;
  /** Selected jobs computed ref. */
  selectedJobs: ComputedRef<TranscodeJob[]>;
  /** Last queue snapshot timestamp. */
  lastQueueSnapshotAtMs: Ref<number | null>;
  /** Optional i18n translation function. */
  t?: (key: string) => string;
  /** Callback when a job completes (for preset stats update). */
  onJobCompleted?: (job: TranscodeJob) => void;
}

export interface UseQueueOperationsReturn {
  // ----- Queue State Methods -----
  /** Refresh the queue state from backend. */
  refreshQueueFromBackend: () => Promise<void>;
  /** Apply queue state from backend. */
  applyQueueStateFromBackend: (state: QueueState) => void;
  /** Recompute jobs from backend data. */
  recomputeJobsFromBackend: (backendJobs: TranscodeJob[]) => void;

  // ----- Single Job Operations -----
  /** Wait (pause) a processing job. */
  handleWaitJob: (jobId: string) => Promise<void>;
  /** Resume a paused job. */
  handleResumeJob: (jobId: string) => Promise<void>;
  /** Restart a job. */
  handleRestartJob: (jobId: string) => Promise<void>;
  /** Cancel a job. */
  handleCancelJob: (jobId: string) => Promise<void>;

  // ----- Enqueue Methods -----
  /** Add a mock manual job (for non-Tauri environments). */
  addManualJobMock: () => void;
  /** Enqueue a manual job from a file path. */
  enqueueManualJobFromPath: (path: string) => Promise<void>;

  // ----- Bulk Operations -----
  /** Cancel all selected jobs. */
  bulkCancelSelectedJobs: () => Promise<void>;
  /** Wait all selected processing jobs. */
  bulkWaitSelectedJobs: () => Promise<void>;
  /** Resume all selected paused jobs. */
  bulkResumeSelectedJobs: () => Promise<void>;
  /** Restart all selected non-terminal jobs. */
  bulkRestartSelectedJobs: () => Promise<void>;
  /** Move selected waiting jobs to top of queue. */
  bulkMoveSelectedJobsToTop: () => Promise<void>;
  /** Move selected waiting jobs to bottom of queue. */
  bulkMoveSelectedJobsToBottom: () => Promise<void>;

  // ----- Queue Reordering -----
  /** Build ordered IDs of waiting jobs. */
  buildWaitingQueueIds: () => string[];
  /** Reorder the waiting queue. */
  reorderWaitingQueue: (orderedIds: string[]) => Promise<void>;
}

/**
 * Composable for queue operations (CRUD, bulk actions, reordering).
 */
export function useQueueOperations(options: UseQueueOperationsOptions): UseQueueOperationsReturn {
  const {
    jobs,
    smartScanJobs,
    manualJobPreset,
    presets,
    queueError,
    selectedJobIds,
    selectedJobs,
    lastQueueSnapshotAtMs,
    t,
    onJobCompleted,
  } = options;

  // ----- Queue State Methods -----

  const recomputeJobsFromBackend = (backendJobs: TranscodeJob[]) => {
    jobs.value = [...smartScanJobs.value, ...backendJobs];
  };

  const applyQueueStateFromBackend = (state: QueueState) => {
    recomputeJobsFromBackend(state.jobs);
    lastQueueSnapshotAtMs.value = Date.now();
  };

  const refreshQueueFromBackend = async () => {
    if (!hasTauri()) return;
    try {
      const previousJobs = jobs.value;
      const previousById = new Map(previousJobs.map((job) => [job.id, job]));
      const state = await loadQueueState();
      const backendJobs = state.jobs ?? [];

      for (const job of backendJobs) {
        const prev = previousById.get(job.id);
        if (job.status === "completed" && (!prev || prev.status !== "completed")) {
          onJobCompleted?.(job);
        }
      }

      recomputeJobsFromBackend(backendJobs);
      queueError.value = null;
    } catch (error) {
      console.error("Failed to refresh queue state", error);
      queueError.value =
        t?.("queue.error.loadFailed") ||
        "队列状态刷新失败，可能是后端未运行或外部工具初始化失败。请检查「软件设置」中的路径与自动下载配置。";
    }
  };

  // ----- Single Job Operations -----

  const handleWaitJob = async (jobId: string) => {
    if (!jobId) return;

    if (!hasTauri()) {
      jobs.value = jobs.value.map((job) =>
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
      const ok = await waitTranscodeJob(jobId);
      if (!ok) {
        queueError.value =
          t?.("queue.error.waitRejected") ||
          "后台拒绝对该任务执行「等待」操作，可能已完成或不在运行中。";
        return;
      }

      jobs.value = jobs.value.map((job) => {
        if (job.id !== jobId) return job;
        if (job.status === "processing") {
          return {
            ...job,
            status: "paused" as JobStatus,
            logs: [
              ...job.logs,
              "Wait requested from UI; worker slot will be released when ffmpeg reaches a safe point",
            ],
          };
        }
        return job;
      });
      queueError.value = null;
    } catch (error) {
      console.error("Failed to wait job", error);
      queueError.value =
        t?.("queue.error.waitFailed") ||
        "对任务执行「等待」操作时出现错误，请稍后重试或检查设置。";
    }
  };

  const handleResumeJob = async (jobId: string) => {
    if (!jobId) return;

    if (!hasTauri()) {
      jobs.value = jobs.value.map((job) =>
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
        queueError.value =
          t?.("queue.error.resumeRejected") ||
          "后台拒绝继续该任务，可能状态已发生变化。";
        return;
      }

      jobs.value = jobs.value.map((job) => {
        if (job.id !== jobId) return job;
        if (job.status === "paused") {
          return {
            ...job,
            status: "waiting" as JobStatus,
            logs: [
              ...job.logs,
              "Resume requested from UI; job re-entered waiting queue",
            ],
          };
        }
        return job;
      });
      queueError.value = null;
    } catch (error) {
      console.error("Failed to resume job", error);
      queueError.value =
        t?.("queue.error.resumeFailed") ||
        "继续任务时出现错误，请稍后重试或检查设置。";
    }
  };

  const handleRestartJob = async (jobId: string) => {
    if (!jobId) return;

    if (!hasTauri()) {
      jobs.value = jobs.value.map((job) =>
        job.id === jobId &&
        job.status !== "completed" &&
        job.status !== "skipped" &&
        job.status !== "cancelled"
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
        queueError.value =
          t?.("queue.error.restartRejected") ||
          "后台拒绝重新开始该任务，可能状态已发生变化。";
        return;
      }

      jobs.value = jobs.value.map((job) => {
        if (job.id !== jobId) return job;
        if (
          job.status !== "completed" &&
          job.status !== "skipped" &&
          job.status !== "cancelled"
        ) {
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
      queueError.value = null;
    } catch (error) {
      console.error("Failed to restart job", error);
      queueError.value =
        t?.("queue.error.restartFailed") ||
        "重新开始任务时出现错误，请稍后重试或检查设置。";
    }
  };

  const handleCancelJob = async (jobId: string) => {
    if (!jobId) return;

    if (!hasTauri()) {
      jobs.value = jobs.value.map((job) =>
        job.id === jobId &&
        (job.status === "waiting" ||
          job.status === "processing" ||
          job.status === "paused")
          ? {
              ...job,
              status: "cancelled" as JobStatus,
              logs: [...job.logs, "Cancelled in simulated mode"],
            }
          : job,
      );
      return;
    }

    try {
      const ok = await cancelTranscodeJob(jobId);
      if (!ok) {
        queueError.value =
          t?.("queue.error.cancelRejected") ||
          "后台拒绝取消该任务，可能已经完成或处于不可取消状态。";
        return;
      }

      jobs.value = jobs.value.map((job) => {
        if (job.id !== jobId) return job;
        if (
          job.status === "waiting" ||
          job.status === "queued" ||
          job.status === "paused"
        ) {
          return { ...job, status: "cancelled" as JobStatus };
        }
        if (job.status === "processing") {
          return {
            ...job,
            status: "cancelled" as JobStatus,
            logs: [
              ...job.logs,
              "Cancellation requested from UI; waiting for backend to stop ffmpeg",
            ],
          };
        }
        return job;
      });
      queueError.value = null;
    } catch (error) {
      console.error("Failed to cancel job", error);
      queueError.value =
        t?.("queue.error.cancelFailed") ||
        "取消任务时出现错误，可能与外部工具或后端状态有关。请稍后重试或检查设置。";
    }
  };

  // ----- Enqueue Methods -----

  const addManualJobMock = () => {
    const presetForJob = manualJobPreset.value ?? presets.value[0];
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
    jobs.value = [newJob, ...jobs.value];
  };

  const enqueueManualJobFromPath = async (path: string) => {
    const preset = manualJobPreset.value ?? presets.value[0];
    if (!preset) {
      console.error("No preset available for manual job");
      queueError.value =
        t?.("queue.error.enqueueFailed") ||
        "无法将任务加入队列：当前没有可用的预设，请先在「预设管理」中创建至少一个预设。";
      return;
    }

    try {
      // Let the backend compute accurate size and codec; we only provide the path and preset.
      await enqueueTranscodeJob({
        filename: path,
        jobType: "video",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: preset.id,
      });

      // Avoid racing with queue stream events; let backend be the single source of truth.
      await refreshQueueFromBackend();
      queueError.value = null;
    } catch (error) {
      console.error("Failed to enqueue manual job from path", error);
      queueError.value =
        t?.("queue.error.enqueueFailed") ||
        "无法将任务加入队列，可能是外部工具未准备好或自动下载失败。请检查「软件设置」中的外部工具配置。";
    }
  };

  // ----- Bulk Operations -----

  const bulkCancelSelectedJobs = async () => {
    const ids = Array.from(selectedJobIds.value);
    for (const id of ids) {
      await handleCancelJob(id);
    }
  };

  const bulkWaitSelectedJobs = async () => {
    const ids = selectedJobs.value
      .filter((job) => job.status === "processing")
      .map((job) => job.id);
    for (const id of ids) {
      await handleWaitJob(id);
    }
  };

  const bulkResumeSelectedJobs = async () => {
    const ids = selectedJobs.value
      .filter((job) => job.status === "paused")
      .map((job) => job.id);
    for (const id of ids) {
      await handleResumeJob(id);
    }
  };

  const bulkRestartSelectedJobs = async () => {
    const ids = selectedJobs.value
      .filter(
        (job) =>
          job.status !== "completed" &&
          job.status !== "skipped" &&
          job.status !== "cancelled",
      )
      .map((job) => job.id);
    for (const id of ids) {
      await handleRestartJob(id);
    }
  };

  // ----- Queue Reordering -----

  const buildWaitingQueueIds = (): string[] => {
    const waiting = jobs.value
      .filter(
        (job) =>
          !job.batchId &&
          (job.status === "waiting" ||
            job.status === "queued" ||
            job.status === "paused"),
      )
      .slice()
      .sort((a, b) => {
        const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        const as = a.startTime ?? 0;
        const bs = b.startTime ?? 0;
        if (as !== bs) return as - bs;
        return a.id.localeCompare(b.id);
      });
    return waiting.map((job) => job.id);
  };

  const reorderWaitingQueueLocal = (orderedIds: string[]) => {
    const waitingIds = buildWaitingQueueIds();
    const explicitSet = new Set(orderedIds);
    const remaining = waitingIds.filter((id) => !explicitSet.has(id));
    const nextOrder = [...orderedIds, ...remaining];

    jobs.value = jobs.value.slice().sort((a, b) => {
      const ai = nextOrder.indexOf(a.id);
      const bi = nextOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  };

  const reorderWaitingQueue = async (orderedIds: string[]) => {
    if (orderedIds.length === 0) return;

    if (!hasTauri()) {
      reorderWaitingQueueLocal(orderedIds);
      return;
    }

    try {
      const ok = await reorderQueue(orderedIds);
      if (!ok) {
        queueError.value =
          t?.("queue.error.reorderRejected") ||
          "后台拒绝调整等待队列顺序，可能当前队列已发生变化。";
        return;
      }
      queueError.value = null;
      await refreshQueueFromBackend();
    } catch (error) {
      console.error("Failed to reorder waiting queue", error);
      queueError.value =
        t?.("queue.error.reorderFailed") ||
        "调整等待队列顺序时出现错误，请稍后重试或检查设置。";
    }
  };

  const bulkMoveSelectedJobsToTop = async () => {
    const ids = selectedJobs.value
      .filter((job) =>
        ["waiting", "queued", "paused"].includes(job.status as string),
      )
      .map((job) => job.id);
    if (ids.length === 0) return;

    const waitingIds = buildWaitingQueueIds();
    const selectedSet = new Set(ids);
    const remaining = waitingIds.filter((id) => !selectedSet.has(id));
    const next = [...ids, ...remaining];
    await reorderWaitingQueue(next);
  };

  const bulkMoveSelectedJobsToBottom = async () => {
    const ids = selectedJobs.value
      .filter((job) =>
        ["waiting", "queued", "paused"].includes(job.status as string),
      )
      .map((job) => job.id);
    if (ids.length === 0) return;

    const waitingIds = buildWaitingQueueIds();
    const selectedSet = new Set(ids);
    const unselected = waitingIds.filter((id) => !selectedSet.has(id));
    const next = [...unselected, ...ids];
    await reorderWaitingQueue(next);
  };

  return {
    // Queue State Methods
    refreshQueueFromBackend,
    applyQueueStateFromBackend,
    recomputeJobsFromBackend,

    // Single Job Operations
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
    handleCancelJob,

    // Enqueue Methods
    addManualJobMock,
    enqueueManualJobFromPath,

    // Bulk Operations
    bulkCancelSelectedJobs,
    bulkWaitSelectedJobs,
    bulkResumeSelectedJobs,
    bulkRestartSelectedJobs,
    bulkMoveSelectedJobsToTop,
    bulkMoveSelectedJobsToBottom,

    // Queue Reordering
    buildWaitingQueueIds,
    reorderWaitingQueue,
  };
}

export default useQueueOperations;
