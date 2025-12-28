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

type ToastAction = { label: string; onClick: () => void };

const showNoopToast = async (title: string, description?: string, action?: ToastAction) => {
  await nextTick();
  toast.info(title, { description, duration: 3500, action });
};

const showSuccessToast = async (title: string, description?: string, action?: ToastAction) => {
  await nextTick();
  toast.success(title, { description, duration: 3500, action });
};

const showErrorToast = async (title: string, description?: string, action?: ToastAction) => {
  await nextTick();
  toast.error(title, { description, duration: 6000, action });
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

  const statusOrder: Array<TranscodeJob["status"]> = [
    "queued",
    "processing",
    "paused",
    "completed",
    "failed",
    "skipped",
    "cancelled",
  ];

  const buildStatusBreakdownLines = (selected: TranscodeJob[]) => {
    const counts = new Map<TranscodeJob["status"], number>();
    for (const job of selected) {
      counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    }
    const lines: string[] = [];
    for (const status of statusOrder) {
      const count = counts.get(status) ?? 0;
      if (count <= 0) continue;
      lines.push(`${t(`queue.status.${status}`)}: ${count}`);
    }
    return lines;
  };

  const buildReport = (params: {
    selectedBefore: TranscodeJob[];
    selectedAfter: TranscodeJob[];
    eligible: number;
    ignored: number;
    removed?: number;
    error?: string;
  }) => {
    const lines: string[] = [
      t("queue.feedback.report.selected", { count: params.selectedBefore.length }),
      t("queue.feedback.report.eligible", { count: params.eligible }),
      t("queue.feedback.report.ignored", { count: params.ignored }),
    ];
    if (typeof params.removed === "number") {
      lines.push(t("queue.feedback.report.removed", { count: params.removed }));
    }
    lines.push(
      "",
      t("queue.feedback.report.before"),
      t("queue.feedback.report.status"),
      ...buildStatusBreakdownLines(params.selectedBefore),
      "",
      t("queue.feedback.report.after"),
      t("queue.feedback.report.status"),
      ...buildStatusBreakdownLines(params.selectedAfter),
    );
    if (params.error) {
      lines.push("", t("queue.feedback.report.error", { message: params.error }));
    }
    return lines.join("\n");
  };

  const detailsActionFor = (report: string): ToastAction => ({
    label: t("queue.feedback.report.action"),
    onClick: () => {
      toast.message(t("queue.feedback.report.title"), { description: report, duration: 12_000 });
    },
  });

  const resolveSelectedAfter = (ids: string[]): TranscodeJob[] => {
    if (ids.length === 0) return [];
    const byId = new Map(jobs.value.map((job) => [job.id, job]));
    const after: TranscodeJob[] = [];
    for (const id of ids) {
      const job = byId.get(id);
      if (job) after.push(job);
    }
    return after;
  };

  const bulkWait = async () => {
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const queued = selectedBefore.filter((job) => job.status === "queued").length;
    const processing = selectedBefore.filter((job) => job.status === "processing").length;
    const eligible = queued + processing;
    const ignored = selectedBefore.length - eligible;
    const detailsAction = detailsActionFor(
      buildReport({ selectedBefore, selectedAfter: resolveSelectedAfter(selectedIds), eligible, ignored }),
    );

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkWait.noneTitle"),
        t("queue.feedback.bulkWait.noneDescription", { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await bulkWaitSelectedJobs();
    const selectedAfterFinal = resolveSelectedAfter(selectedIds);
    if (queueError.value) {
      await showErrorToast(
        t("queue.feedback.bulkWait.errorTitle"),
        queueError.value,
        detailsActionFor(
          buildReport({
            selectedBefore,
            selectedAfter: selectedAfterFinal,
            eligible,
            ignored,
            error: queueError.value,
          }),
        ),
      );
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkWait.successTitle"),
      t("queue.feedback.bulkWait.successDescription", {
        selected: selectedCount,
        eligible,
        queued,
        processing,
        ignored,
      }),
      detailsActionFor(buildReport({ selectedBefore, selectedAfter: selectedAfterFinal, eligible, ignored })),
    );
  };

  const bulkResume = async () => {
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const eligible = selectedBefore.filter((job) => job.status === "paused").length;
    const ignored = selectedBefore.length - eligible;
    const detailsAction = detailsActionFor(
      buildReport({ selectedBefore, selectedAfter: resolveSelectedAfter(selectedIds), eligible, ignored }),
    );

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkResume.noneTitle"),
        t("queue.feedback.bulkResume.noneDescription", { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await bulkResumeSelectedJobs();
    await nextTick();
    const selectedAfter = resolveSelectedAfter(selectedIds);
    if (queueError.value) {
      await showErrorToast(
        t("queue.feedback.bulkResume.errorTitle"),
        queueError.value,
        detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored, error: queueError.value })),
      );
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkResume.successTitle"),
      t("queue.feedback.bulkResume.successDescription", { selected: selectedCount, count: eligible, ignored }),
      detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored })),
    );
  };

  const bulkRestart = async () => {
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const eligible = selectedBefore.filter((job) => job.status !== "completed" && job.status !== "skipped").length;
    const ignored = selectedBefore.length - eligible;
    const detailsAction = detailsActionFor(
      buildReport({ selectedBefore, selectedAfter: resolveSelectedAfter(selectedIds), eligible, ignored }),
    );

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkRestart.noneTitle"),
        t("queue.feedback.bulkRestart.noneDescription", { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await bulkRestartSelectedJobs();
    const selectedAfter = resolveSelectedAfter(selectedIds);
    if (queueError.value) {
      await showErrorToast(
        t("queue.feedback.bulkRestart.errorTitle"),
        queueError.value,
        detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored, error: queueError.value })),
      );
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkRestart.successTitle"),
      t("queue.feedback.bulkRestart.successDescription", { selected: selectedCount, count: eligible, ignored }),
      detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored })),
    );
  };

  const bulkMoveToTop = async () => {
    await bulkMoveWaiting("bulkMoveToTop", bulkMoveSelectedJobsToTopInner);
  };

  const bulkMoveToBottom = async () => {
    await bulkMoveWaiting("bulkMoveToBottom", bulkMoveSelectedJobsToBottomInner);
  };

  async function bulkMoveWaiting(key: "bulkMoveToTop" | "bulkMoveToBottom", moveSelectedJobs: () => Promise<void>) {
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const eligible = selectedBefore.filter((job) => isWaitingStatus(job.status)).length;
    const ignored = selectedBefore.length - eligible;
    const detailsAction = detailsActionFor(
      buildReport({ selectedBefore, selectedAfter: resolveSelectedAfter(selectedIds), eligible, ignored }),
    );

    if (eligible === 0) {
      await showNoopToast(
        t(`queue.feedback.${key}.noneTitle`),
        t(`queue.feedback.${key}.noneDescription`, { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await moveSelectedJobs();
    const selectedAfter = resolveSelectedAfter(selectedIds);
    if (queueError.value) {
      await showErrorToast(
        t(`queue.feedback.${key}.errorTitle`),
        queueError.value,
        detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored, error: queueError.value })),
      );
      return;
    }

    await showSuccessToast(
      t(`queue.feedback.${key}.successTitle`),
      t(`queue.feedback.${key}.successDescription`, { selected: selectedCount, count: eligible, ignored }),
      detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored })),
    );
  }

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
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const eligible = selectedBefore.filter((job) => isTerminalForBulkDeleteToast(job.status)).length;
    const ignored = selectedBefore.length - eligible;
    if (selectedBefore.length === 0) return;

    await bulkDeleteInner();
    const selectedAfter = resolveSelectedAfter(selectedIds);
    const removed = selectedBefore.length - selectedAfter.length;
    const report = buildReport({ selectedBefore, selectedAfter, eligible, ignored, removed });
    const detailsAction = detailsActionFor(report);

    if (queueError.value) {
      if (removed > 0) {
        await showNoopToast(
          t("queue.feedback.bulkDelete.partialTitle"),
          t("queue.feedback.bulkDelete.partialDescription", {
            selected: selectedCount,
            deleted: removed,
            eligible,
            ignored,
          }),
          detailsActionFor(
            buildReport({ selectedBefore, selectedAfter, eligible, ignored, removed, error: queueError.value }),
          ),
        );
      } else {
        await showErrorToast(
          t("queue.feedback.bulkDelete.errorTitle"),
          queueError.value,
          detailsActionFor(
            buildReport({ selectedBefore, selectedAfter, eligible, ignored, removed, error: queueError.value }),
          ),
        );
      }
      return;
    }

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkDelete.noneTitle"),
        t("queue.feedback.bulkDelete.noneDescription", { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkDelete.successTitle"),
      t("queue.feedback.bulkDelete.successDescription", {
        selected: selectedCount,
        deleted: removed || eligible,
        ignored,
      }),
      detailsAction,
    );
  };

  const bulkCancelWithFeedback = async () => {
    await nextTick();
    const selectedBefore = selectedJobs.value.slice();
    const selectedIds = selectedBefore.map((job) => job.id);
    const selectedCount = selectedBefore.length;
    const eligible = selectedBefore.filter(
      (job) => job.status === "queued" || job.status === "paused" || job.status === "processing",
    ).length;
    const ignored = selectedBefore.length - eligible;
    const detailsAction = detailsActionFor(
      buildReport({ selectedBefore, selectedAfter: resolveSelectedAfter(selectedIds), eligible, ignored }),
    );

    if (eligible === 0) {
      await showNoopToast(
        t("queue.feedback.bulkCancel.noneTitle"),
        t("queue.feedback.bulkCancel.noneDescription", { selected: selectedCount }),
        detailsAction,
      );
      return;
    }

    await bulkCancelSelectedJobs();
    const selectedAfter = resolveSelectedAfter(selectedIds);
    if (queueError.value) {
      await showErrorToast(
        t("queue.feedback.bulkCancel.errorTitle"),
        queueError.value,
        detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored, error: queueError.value })),
      );
      return;
    }

    await showSuccessToast(
      t("queue.feedback.bulkCancel.successTitle"),
      t("queue.feedback.bulkCancel.successDescription", { selected: selectedCount, count: eligible, ignored }),
      detailsActionFor(buildReport({ selectedBefore, selectedAfter, eligible, ignored })),
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
