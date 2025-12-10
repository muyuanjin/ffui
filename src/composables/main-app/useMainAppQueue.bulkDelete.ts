import type { Ref } from "vue";
import { deleteTranscodeJob, hasTauri } from "@/lib/backend";
import type { TranscodeJob } from "@/types";

interface CreateBulkDeleteOptions {
  jobs: Ref<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  selectedJobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  refreshQueueFromBackend: () => Promise<void>;
  t: (key: string) => string;
}

const isTerminalStatus = (status: TranscodeJob["status"]) =>
  status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";

export function createBulkDelete(options: CreateBulkDeleteOptions) {
  const { jobs, selectedJobIds, selectedJobs, queueError, refreshQueueFromBackend, t } = options;

  return async () => {
    const selected = Array.from(selectedJobIds.value);
    if (!selected.length) return;

    // 预先按 batchId 分组，便于对 Smart Scan 批次进行完整性校验。
    const jobsByBatchId = new Map<string, TranscodeJob[]>();
    for (const job of jobs.value) {
      if (!job.batchId) continue;
      const list = jobsByBatchId.get(job.batchId) ?? [];
      list.push(job);
      jobsByBatchId.set(job.batchId, list);
    }

    const terminalJobs = selectedJobs.value.filter((job) => isTerminalStatus(job.status));
    const nonTerminalJobs = selectedJobs.value.filter((job) => !isTerminalStatus(job.status));

    // 对 Smart Scan 批次：若该批次存在任意非终态子任务，则跳过该批次的删除，避免“部分删除”。
    const blockedBatchIds = new Set<string>();
    const terminalJobsAllowed: TranscodeJob[] = [];

    for (const job of terminalJobs) {
      const batchId = job.batchId;
      if (batchId) {
        const batchJobs = jobsByBatchId.get(batchId) ?? [];
        const hasActiveSibling = batchJobs.some((item) => !isTerminalStatus(item.status));
        if (hasActiveSibling) {
          blockedBatchIds.add(batchId);
          continue;
        }
      }
      terminalJobsAllowed.push(job);
    }

    if (terminalJobsAllowed.length === 0) {
      queueError.value =
        (t("queue.error.deleteActiveNotAllowed") as string) ??
        "Cannot delete jobs that are still running; please stop them first.";
      selectedJobIds.value = new Set();
      return;
    }

    if (!hasTauri()) {
      const deletableIds = new Set(terminalJobsAllowed.map((job) => job.id));
      jobs.value = jobs.value.filter((job) => !deletableIds.has(job.id));
      selectedJobIds.value = new Set();
      return;
    }

    const failedJobIds: string[] = [];
    for (const job of terminalJobsAllowed) {
      try {
        const ok = await deleteTranscodeJob(job.id);
        if (!ok) {
          failedJobIds.push(job.id);
        }
      } catch {
        failedJobIds.push(job.id);
      }
    }

    if (failedJobIds.length > 0) {
      try {
        await refreshQueueFromBackend();
      } catch {
        queueError.value =
          (t("queue.error.deleteFailed") as string) ?? "Failed to delete some jobs from queue.";
        selectedJobIds.value = new Set();
        return;
      }

      const currentJobs = jobs.value;
      const failedStillPresent = currentJobs.filter((job) => failedJobIds.includes(job.id));

      const failedTerminalStillPresent = failedStillPresent.filter((job) =>
        isTerminalStatus(job.status),
      );
      const failedNonTerminalNow = failedStillPresent.filter(
        (job) => !isTerminalStatus(job.status),
      );

      if (failedTerminalStillPresent.length > 0) {
        queueError.value =
          (t("queue.error.deleteFailed") as string) ?? "Failed to delete some jobs from queue.";
      } else if (
        failedNonTerminalNow.length > 0 ||
        nonTerminalJobs.length > 0 ||
        blockedBatchIds.size > 0
      ) {
        queueError.value =
          (t("queue.error.deleteActiveNotAllowed") as string) ??
          "Cannot delete jobs that are still running; please stop them first.";
      } else {
        queueError.value = null;
      }
    } else if (nonTerminalJobs.length > 0 || blockedBatchIds.size > 0) {
      queueError.value =
        (t("queue.error.deleteActiveNotAllowed") as string) ??
        "Cannot delete jobs that are still running; please stop them first.";
    } else {
      queueError.value = null;
    }

    selectedJobIds.value = new Set();
  };
}
