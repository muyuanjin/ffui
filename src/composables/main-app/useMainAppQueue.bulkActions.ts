import { nextTick, type ComputedRef, type Ref } from "vue";
import { toast } from "vue-sonner";
import type { TranscodeJob, Translate } from "@/types";
import { createBulkDelete } from "./useMainAppQueue.bulkDelete";
import { isWaitingStatus } from "./useMainAppQueue.waiting";

interface CreateQueueBulkActionsWithFeedbackOptions {
  t: Translate;
  jobs: Ref<TranscodeJob[]>;
  selectedJobs: ComputedRef<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  queueError: Ref<string | null>;
  lastQueueSnapshotRevision: Ref<number | null>;
  refreshQueueFromBackend: () => Promise<void>;
  bulkWaitSelectedJobs: () => Promise<void>;
  bulkResumeSelectedJobs: () => Promise<void>;
  bulkRestartSelectedJobs: () => Promise<void>;
  bulkCancelSelectedJobs: () => Promise<void>;
  bulkMoveSelectedJobsToTopInner: () => Promise<void>;
  bulkMoveSelectedJobsToBottomInner: () => Promise<void>;
}

const showNoopToast = async (title: string, description?: string) => {
  await nextTick();
  toast.info(title, { description, duration: 3500 });
};

const showSuccessToast = async (title: string, description?: string) => {
  await nextTick();
  toast.success(title, { description, duration: 3500 });
};

const showErrorToast = async (title: string, description?: string) => {
  await nextTick();
  toast.error(title, { description, duration: 6000 });
};

export function createQueueBulkActionsWithFeedback(options: CreateQueueBulkActionsWithFeedbackOptions) {
  const {
    t,
    jobs,
    selectedJobs,
    selectedJobIds,
    queueError,
    lastQueueSnapshotRevision,
    refreshQueueFromBackend,
    bulkWaitSelectedJobs,
    bulkResumeSelectedJobs,
    bulkRestartSelectedJobs,
    bulkCancelSelectedJobs,
    bulkMoveSelectedJobsToTopInner,
    bulkMoveSelectedJobsToBottomInner,
  } = options;

  const bulkWait = async () => {
    const selected = selectedJobs.value;
    const queued = selected.filter((job) => job.status === "queued").length;
    const processing = selected.filter((job) => job.status === "processing").length;
    const eligible = queued + processing;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(t("queue.feedback.bulkWait.noneTitle"), t("queue.feedback.bulkWait.noneDescription"));
      return;
    }

    await bulkWaitSelectedJobs();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkWait.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkWait.successTitle"),
      t("queue.feedback.bulkWait.successDescription", { queued, processing, ignored }),
    );
  };

  const bulkResume = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter((job) => job.status === "paused").length;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(t("queue.feedback.bulkResume.noneTitle"), t("queue.feedback.bulkResume.noneDescription"));
      return;
    }

    await bulkResumeSelectedJobs();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkResume.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkResume.successTitle"),
      t("queue.feedback.bulkResume.successDescription", { count: eligible, ignored }),
    );
  };

  const bulkRestart = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter((job) => job.status !== "completed" && job.status !== "skipped").length;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(t("queue.feedback.bulkRestart.noneTitle"), t("queue.feedback.bulkRestart.noneDescription"));
      return;
    }

    await bulkRestartSelectedJobs();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkRestart.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkRestart.successTitle"),
      t("queue.feedback.bulkRestart.successDescription", { count: eligible, ignored }),
    );
  };

  const bulkMoveToTop = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter((job) => isWaitingStatus(job.status)).length;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkMoveToTop.noneTitle"),
        t("queue.feedback.bulkMoveToTop.noneDescription"),
      );
      return;
    }

    await bulkMoveSelectedJobsToTopInner();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkMoveToTop.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkMoveToTop.successTitle"),
      t("queue.feedback.bulkMoveToTop.successDescription", { count: eligible, ignored }),
    );
  };

  const bulkMoveToBottom = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter((job) => isWaitingStatus(job.status)).length;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkMoveToBottom.noneTitle"),
        t("queue.feedback.bulkMoveToBottom.noneDescription"),
      );
      return;
    }

    await bulkMoveSelectedJobsToBottomInner();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkMoveToBottom.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkMoveToBottom.successTitle"),
      t("queue.feedback.bulkMoveToBottom.successDescription", { count: eligible, ignored }),
    );
  };

  const isTerminalForBulkDeleteToast = (status: TranscodeJob["status"]) =>
    status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";

  const bulkDeleteInner = createBulkDelete({
    jobs,
    selectedJobIds,
    selectedJobs,
    queueError,
    lastQueueSnapshotRevision,
    refreshQueueFromBackend,
    t: (key: string) => t(key),
  });

  const bulkDelete = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter((job) => isTerminalForBulkDeleteToast(job.status)).length;
    const ignored = selected.length - eligible;
    if (selected.length === 0) return;

    const before = jobs.value.length;
    await bulkDeleteInner();
    const after = jobs.value.length;
    const deleted = Math.max(0, before - after);

    if (queueError.value) {
      if (deleted > 0) {
        await showNoopToast(
          t("queue.feedback.bulkDelete.partialTitle"),
          t("queue.feedback.bulkDelete.partialDescription", { deleted, eligible, ignored }),
        );
      } else {
        await showErrorToast(t("queue.feedback.bulkDelete.errorTitle"), queueError.value);
      }
      return;
    }

    if (eligible === 0) {
      await showNoopToast(t("queue.feedback.bulkDelete.noneTitle"), t("queue.feedback.bulkDelete.noneDescription"));
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkDelete.successTitle"),
      t("queue.feedback.bulkDelete.successDescription", { deleted: deleted || eligible, ignored }),
    );
  };

  const bulkCancelWithFeedback = async () => {
    const selected = selectedJobs.value;
    const eligible = selected.filter(
      (job) => job.status === "queued" || job.status === "paused" || job.status === "processing",
    ).length;
    const ignored = selected.length - eligible;

    if (eligible === 0) {
      await showNoopToast(t("queue.feedback.bulkCancel.noneTitle"), t("queue.feedback.bulkCancel.noneDescription"));
      return;
    }

    await bulkCancelSelectedJobs();
    if (queueError.value) {
      await showErrorToast(t("queue.feedback.bulkCancel.errorTitle"), queueError.value);
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkCancel.successTitle"),
      t("queue.feedback.bulkCancel.successDescription", { count: eligible, ignored }),
    );
  };

  const moveJobToTop = async (jobId: string) => {
    if (!jobId) return;
    selectedJobIds.value = new Set([jobId]);
    await bulkMoveSelectedJobsToTopInner();
  };

  const bulkMoveSelectedJobsToTop = async () => bulkMoveSelectedJobsToTopInner();
  const bulkMoveSelectedJobsToBottom = async () => bulkMoveSelectedJobsToBottomInner();

  return {
    bulkWait,
    bulkResume,
    bulkRestart,
    bulkMoveToTop,
    bulkMoveToBottom,
    bulkDelete,
    bulkCancelWithFeedback,
    bulkMoveSelectedJobsToTop,
    bulkMoveSelectedJobsToBottom,
    moveJobToTop,
  };
}
