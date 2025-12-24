import { type Ref, type ComputedRef } from "vue";
import type { TranscodeJob, FFmpegPreset, QueueState, Translate } from "@/types";
import {
  refreshQueueFromBackend as refreshQueueFromBackendImpl,
  applyQueueStateFromBackend as applyQueueStateFromBackendImpl,
  recomputeJobsFromBackend as recomputeJobsFromBackendImpl,
} from "./queue/operations-state-sync";
import {
  handleWaitJob as handleWaitJobImpl,
  handleResumeJob as handleResumeJobImpl,
  handleRestartJob as handleRestartJobImpl,
  handleCancelJob as handleCancelJobImpl,
  addManualJobMock as addManualJobMockImpl,
  enqueueManualJobsFromPaths as enqueueManualJobsFromPathsImpl,
  enqueueManualJobFromPath as enqueueManualJobFromPathImpl,
} from "./queue/operations-single";
import {
  bulkCancelSelectedJobs as bulkCancelSelectedJobsImpl,
  bulkWaitSelectedJobs as bulkWaitSelectedJobsImpl,
  bulkResumeSelectedJobs as bulkResumeSelectedJobsImpl,
  bulkRestartSelectedJobs as bulkRestartSelectedJobsImpl,
  buildWaitingQueueIds as buildWaitingQueueIdsImpl,
  reorderWaitingQueue as reorderWaitingQueueImpl,
  bulkMoveSelectedJobsToTop as bulkMoveSelectedJobsToTopImpl,
  bulkMoveSelectedJobsToBottom as bulkMoveSelectedJobsToBottomImpl,
} from "./queue/operations-bulk";
import type { QueueOperationMethods } from "./queue/queueOperations.types";

// ----- Composable -----

export interface UseQueueOperationsOptions {
  /** The list of jobs (will be updated by operations). */
  jobs: Ref<TranscodeJob[]>;
  /** Job ids that have a pending "wait" request but are still processing. */
  pausingJobIds: Ref<Set<string>>;
  /** Batch Compress jobs to merge with backend jobs. */
  batchCompressJobs: Ref<TranscodeJob[]>;
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
  t?: Translate;
  /** Callback when a job completes (for preset stats update). */
  onJobCompleted?: (job: TranscodeJob) => void;
}

export interface UseQueueOperationsReturn extends QueueOperationMethods {
  // ----- Queue State Methods -----
  /** Apply queue state from backend. */
  applyQueueStateFromBackend: (state: QueueState) => void;
  /** Recompute jobs from backend data. */
  recomputeJobsFromBackend: (backendJobs: TranscodeJob[]) => void;

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
    pausingJobIds,
    batchCompressJobs,
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

  const stateSyncDeps = {
    jobs,
    batchCompressJobs,
    queueError,
    lastQueueSnapshotAtMs,
    t,
    onJobCompleted,
  };

  const recomputeJobsFromBackend = (backendJobs: TranscodeJob[]) =>
    recomputeJobsFromBackendImpl(backendJobs, stateSyncDeps);

  const applyQueueStateFromBackend = (state: QueueState) => applyQueueStateFromBackendImpl(state, stateSyncDeps);

  const refreshQueueFromBackend = async () => refreshQueueFromBackendImpl(stateSyncDeps);

  // ----- Single Job Operations -----

  const singleJobOpsDeps = {
    jobs,
    pausingJobIds,
    manualJobPreset,
    presets,
    queueError,
    t,
    refreshQueueFromBackend,
  };

  const handleWaitJob = async (jobId: string) => handleWaitJobImpl(jobId, singleJobOpsDeps);

  const handleResumeJob = async (jobId: string) => handleResumeJobImpl(jobId, singleJobOpsDeps);

  const handleRestartJob = async (jobId: string) => handleRestartJobImpl(jobId, singleJobOpsDeps);

  const handleCancelJob = async (jobId: string) => handleCancelJobImpl(jobId, singleJobOpsDeps);

  // ----- Enqueue Methods -----

  const addManualJobMock = () => addManualJobMockImpl(singleJobOpsDeps);

  const enqueueManualJobFromPath = async (path: string) => enqueueManualJobFromPathImpl(path, singleJobOpsDeps);

  const enqueueManualJobsFromPaths = async (paths: string[]) => enqueueManualJobsFromPathsImpl(paths, singleJobOpsDeps);

  // ----- Bulk Operations -----

  const bulkOpsDeps = {
    jobs,
    selectedJobIds,
    selectedJobs,
    queueError,
    t,
    refreshQueueFromBackend,
    handleCancelJob,
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
  };

  const bulkCancelSelectedJobs = async () => bulkCancelSelectedJobsImpl(bulkOpsDeps);

  const bulkWaitSelectedJobs = async () => bulkWaitSelectedJobsImpl(bulkOpsDeps);

  const bulkResumeSelectedJobs = async () => bulkResumeSelectedJobsImpl(bulkOpsDeps);

  const bulkRestartSelectedJobs = async () => bulkRestartSelectedJobsImpl(bulkOpsDeps);

  // ----- Queue Reordering -----

  const buildWaitingQueueIds = (): string[] => buildWaitingQueueIdsImpl(bulkOpsDeps);

  const reorderWaitingQueue = async (orderedIds: string[]) => reorderWaitingQueueImpl(orderedIds, bulkOpsDeps);

  const bulkMoveSelectedJobsToTop = async () => bulkMoveSelectedJobsToTopImpl(bulkOpsDeps);

  const bulkMoveSelectedJobsToBottom = async () => bulkMoveSelectedJobsToBottomImpl(bulkOpsDeps);

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
    enqueueManualJobsFromPaths,

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
