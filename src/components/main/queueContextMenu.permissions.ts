import { computed } from "vue";
import type { JobStatus, JobType, QueueBulkActionKind, QueueMode } from "@/types";

export interface QueueContextMenuPermissionProps {
  mode: "single" | "bulk";
  queueMode: QueueMode;
  jobStatus?: JobStatus;
  jobType?: JobType;
  hasSelection: boolean;
  bulkActionInProgress?: QueueBulkActionKind | null;
  canRevealInputPath?: boolean;
  canRevealOutputPath?: boolean;
}

export function createQueueContextMenuPermissions(props: QueueContextMenuPermissionProps) {
  const isQueueMode = computed(() => props.queueMode === "queue");
  const status = computed<JobStatus | undefined>(() => props.jobStatus);

  const canRevealInput = computed(() => props.mode === "single" && props.canRevealInputPath === true);
  const canRevealOutput = computed(() => props.mode === "single" && props.canRevealOutputPath === true);

  const isTerminalStatus = (value: JobStatus | undefined) =>
    value === "completed" || value === "failed" || value === "skipped" || value === "cancelled";

  // 允许在显示模式下也能进行暂停/继续操作（仅影响单个任务状态，不改变队列优先级）。
  const canWait = computed(() => props.mode === "single" && status.value === "processing");
  const canResume = computed(() => props.mode === "single" && status.value === "paused");

  const canRestart = computed(
    () =>
      props.mode === "single" &&
      status.value !== undefined &&
      status.value !== "completed" &&
      status.value !== "skipped",
  );

  const canCancel = computed(
    () =>
      props.mode === "single" &&
      status.value !== undefined &&
      (status.value === "queued" || status.value === "processing" || status.value === "paused"),
  );

  const canMove = computed(() => props.mode === "single" && isQueueMode.value);
  const canDeleteSingle = computed(() => props.mode === "single" && isTerminalStatus(status.value));

  const canCompare = computed(() => {
    if (props.mode !== "single") return false;
    if (props.jobType !== "video") return false;
    return status.value === "processing" || status.value === "paused" || status.value === "completed";
  });

  const canBulkBase = computed(() => props.mode === "bulk" && props.hasSelection);
  const bulkBusy = computed(() => props.bulkActionInProgress !== null && props.bulkActionInProgress !== undefined);

  const canBulkCancel = computed(() => canBulkBase.value);
  // 批量暂停/继续在显示模式下也允许；批量移动仍仅在队列模式下。
  const canBulkWait = computed(() => canBulkBase.value);
  const canBulkResume = computed(() => canBulkBase.value);
  const canBulkRestart = computed(() => canBulkBase.value);
  const canBulkMove = computed(() => canBulkBase.value && isQueueMode.value);
  const canBulkDelete = computed(() => canBulkBase.value);

  return {
    isQueueMode,
    status,
    canRevealInput,
    canRevealOutput,
    canWait,
    canResume,
    canRestart,
    canCancel,
    canMove,
    canDeleteSingle,
    canCompare,
    canBulkBase,
    bulkBusy,
    canBulkCancel,
    canBulkWait,
    canBulkResume,
    canBulkRestart,
    canBulkMove,
    canBulkDelete,
  };
}
