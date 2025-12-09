import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { JobStatus, TranscodeJob } from "@/types";
import { hasTauri, revealPathInFolder } from "@/lib/backend";

export interface UseQueueContextMenuOptions {
  jobs: Ref<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  handleWaitJob: (jobId: string) => Promise<void>;
  handleResumeJob: (jobId: string) => Promise<void>;
  handleRestartJob: (jobId: string) => Promise<void>;
  handleCancelJob: (jobId: string) => Promise<void>;
  /** 批量取消当前选中任务 */
  bulkCancel: () => Promise<void>;
  /** 批量暂停当前选中任务 */
  bulkWait: () => Promise<void>;
  /** 批量继续当前选中任务 */
  bulkResume: () => Promise<void>;
  /** 批量重新开始当前选中任务 */
  bulkRestart: () => Promise<void>;
  bulkMoveToTop: () => Promise<void>;
  bulkMoveToBottom: () => Promise<void>;
  bulkDelete: () => void;
  openJobDetail: (job: TranscodeJob) => void | Promise<void>;
}

export interface UseQueueContextMenuReturn {
  queueContextMenuVisible: Ref<boolean>;
  queueContextMenuMode: Ref<"single" | "bulk">;
  queueContextMenuX: Ref<number>;
  queueContextMenuY: Ref<number>;
  queueContextMenuJobId: Ref<string | null>;
  queueContextMenuJob: ComputedRef<TranscodeJob | null>;
  queueContextMenuJobStatus: ComputedRef<JobStatus | undefined>;
  queueContextMenuCanRevealInputPath: ComputedRef<boolean>;
  queueContextMenuCanRevealOutputPath: ComputedRef<boolean>;
  openQueueContextMenuForJob: (payload: { job: TranscodeJob; event: MouseEvent }) => void;
  openQueueContextMenuForBulk: (event: MouseEvent) => void;
  closeQueueContextMenu: () => void;
  handleQueueContextInspect: () => void;
  handleQueueContextWait: () => Promise<void>;
  handleQueueContextResume: () => Promise<void>;
  handleQueueContextRestart: () => Promise<void>;
  handleQueueContextCancel: () => Promise<void>;
  handleQueueContextMoveToTop: () => Promise<void>;
  handleQueueContextMoveToBottom: () => Promise<void>;
  handleQueueContextDelete: () => void;
  handleQueueContextOpenInputFolder: () => Promise<void>;
  handleQueueContextOpenOutputFolder: () => Promise<void>;
}

export function useQueueContextMenu(
  options: UseQueueContextMenuOptions,
): UseQueueContextMenuReturn {
  const {
    jobs,
    selectedJobIds,
    handleWaitJob,
    handleResumeJob,
    handleRestartJob,
    handleCancelJob,
    bulkCancel,
    bulkWait,
    bulkResume,
    bulkRestart,
    bulkMoveToTop,
    bulkMoveToBottom,
    bulkDelete,
    openJobDetail,
  } = options;

  const queueContextMenuVisible = ref(false);
  const queueContextMenuMode = ref<"single" | "bulk">("single");
  const queueContextMenuX = ref(0);
  const queueContextMenuY = ref(0);
  const queueContextMenuJobId = ref<string | null>(null);

  const queueContextMenuJob = computed(() =>
    jobs.value.find((job) => job.id === queueContextMenuJobId.value) ?? null,
  );

  const queueContextMenuJobStatus = computed<JobStatus | undefined>(
    () => queueContextMenuJob.value?.status,
  );

  const queueContextMenuInputPath = computed<string | null>(() => {
    const job = queueContextMenuJob.value;
    if (!job) return null;
    const path = job.inputPath || job.filename || "";
    const trimmed = path.trim();
    return trimmed ? trimmed : null;
  });

  const queueContextMenuOutputPath = computed<string | null>(() => {
    const job = queueContextMenuJob.value;
    if (!job) return null;
    const path = job.outputPath || job.waitMetadata?.tmpOutputPath || "";
    const trimmed = path?.trim?.() ?? "";
    return trimmed ? trimmed : null;
  });

  const queueContextMenuCanRevealInputPath = computed(
    () => hasTauri() && !!queueContextMenuInputPath.value,
  );

  const queueContextMenuCanRevealOutputPath = computed(
    () => hasTauri() && !!queueContextMenuOutputPath.value,
  );

  const openQueueContextMenuForJob = (payload: { job: TranscodeJob; event: MouseEvent }) => {
    const { job, event } = payload;
    queueContextMenuMode.value = "single";
    queueContextMenuVisible.value = true;
    queueContextMenuX.value = event.clientX;
    queueContextMenuY.value = event.clientY;
    queueContextMenuJobId.value = job.id;
    // 右键单个任务时，将当前选中集更新为该任务，便于后续批量操作保持一致心智。
    selectedJobIds.value = new Set([job.id]);
  };

  const openQueueContextMenuForBulk = (event: MouseEvent) => {
    queueContextMenuMode.value = "bulk";
    queueContextMenuVisible.value = true;
    queueContextMenuX.value = event.clientX;
    queueContextMenuY.value = event.clientY;
    queueContextMenuJobId.value = null;
  };

  const closeQueueContextMenu = () => {
    queueContextMenuVisible.value = false;
  };

  // Single job context menu handlers
  const handleQueueContextInspect = () => {
    const job = queueContextMenuJob.value;
    if (!job) return;
    openJobDetail(job);
  };

  const handleQueueContextWait = async () => {
    // 批量模式下，统一走批量暂停逻辑
    if (queueContextMenuMode.value === "bulk") {
      await bulkWait();
      return;
    }

    const job = queueContextMenuJob.value;
    if (!job) return;
    await handleWaitJob(job.id);
  };

  const handleQueueContextResume = async () => {
    // 批量模式下，统一走批量继续逻辑
    if (queueContextMenuMode.value === "bulk") {
      await bulkResume();
      return;
    }

    const job = queueContextMenuJob.value;
    if (!job) return;
    await handleResumeJob(job.id);
  };

  const handleQueueContextRestart = async () => {
    // 批量模式下，统一走批量重新开始逻辑
    if (queueContextMenuMode.value === "bulk") {
      await bulkRestart();
      return;
    }

    const job = queueContextMenuJob.value;
    if (!job) return;
    await handleRestartJob(job.id);
  };

  const handleQueueContextCancel = async () => {
    // 批量模式下，统一走批量取消逻辑
    if (queueContextMenuMode.value === "bulk") {
      await bulkCancel();
      return;
    }

    const job = queueContextMenuJob.value;
    if (!job) return;
    await handleCancelJob(job.id);
  };

  // Bulk operations handlers
  const handleQueueContextMoveToTop = async () => {
    if (queueContextMenuMode.value === "single") {
      // 单任务模式下，selectedJobIds 已在打开菜单时指向该任务，直接复用批量"移到队首"逻辑。
      await bulkMoveToTop();
    } else {
      await bulkMoveToTop();
    }
  };

  const handleQueueContextMoveToBottom = async () => {
    await bulkMoveToBottom();
  };

  const handleQueueContextDelete = () => {
    bulkDelete();
  };

  const revealPathIfAvailable = async (path: string | null) => {
    if (!path) return;
    if (!hasTauri()) return;
    try {
      await revealPathInFolder(path);
    } catch (error) {
      console.error("QueueContextMenu: failed to reveal path", error);
    }
  };

  const handleQueueContextOpenInputFolder = async () => {
    await revealPathIfAvailable(queueContextMenuInputPath.value);
  };

  const handleQueueContextOpenOutputFolder = async () => {
    await revealPathIfAvailable(queueContextMenuOutputPath.value);
  };

  return {
    queueContextMenuVisible,
    queueContextMenuMode,
    queueContextMenuX,
    queueContextMenuY,
    queueContextMenuJobId,
    queueContextMenuJob,
    queueContextMenuJobStatus,
    queueContextMenuCanRevealInputPath,
    queueContextMenuCanRevealOutputPath,
    openQueueContextMenuForJob,
    openQueueContextMenuForBulk,
    closeQueueContextMenu,
    handleQueueContextInspect,
    handleQueueContextWait,
    handleQueueContextResume,
    handleQueueContextRestart,
    handleQueueContextCancel,
    handleQueueContextMoveToTop,
    handleQueueContextMoveToBottom,
    handleQueueContextDelete,
    handleQueueContextOpenInputFolder,
    handleQueueContextOpenOutputFolder,
  };
}
