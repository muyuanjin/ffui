import type { Ref } from "vue";
import { deleteSmartScanBatchOnBackend, deleteTranscodeJob, hasTauri } from "@/lib/backend";
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

    // 预先按 batchId 分组，便于对 Smart Scan 批次进行完整性校验和批量删除。
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

    // 进一步识别“整批选中”的 Smart Scan 批次：
    // 当某个 batchId 的所有子任务都处于终态且都在选中集内时，可以优先调用后端
    // delete_smart_scan_batch 一次性删除，避免对每个子任务单独发 N 个请求。
    const terminalJobsByBatchId = new Map<string, TranscodeJob[]>();
    for (const job of terminalJobsAllowed) {
      if (!job.batchId) continue;
      const list = terminalJobsByBatchId.get(job.batchId) ?? [];
      list.push(job);
      terminalJobsByBatchId.set(job.batchId, list);
    }

    const fullBatchIdsToDelete = new Set<string>();
    for (const [batchId, batchJobs] of jobsByBatchId) {
      const selectedForBatch = terminalJobsByBatchId.get(batchId);
      if (!selectedForBatch) continue;
      // 仅当该批次所有子任务都已处于终态且全部被选中时，才视为“整批删除”。
      const allTerminal = batchJobs.every((job) => isTerminalStatus(job.status));
      if (!allTerminal) continue;
      if (selectedForBatch.length === batchJobs.length) {
        fullBatchIdsToDelete.add(batchId);
      }
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

    // Tauri 模式下，优先对整批选中的 Smart Scan 批次使用批量删除命令，
    // 其它任务仍然逐个调用 delete_transcode_job。
    const failedJobIds: string[] = [];

    // 1) 批次级删除（Smart Scan 复合任务）。
    for (const batchId of fullBatchIdsToDelete) {
      const batchJobs = jobsByBatchId.get(batchId) ?? [];
      if (!batchJobs.length) {
        continue;
      }

      try {
        const ok = await deleteSmartScanBatchOnBackend(batchId);
        if (!ok) {
          // 若批次删除失败，则认为该批次所有子任务均删除失败，统一纳入错误集合。
          for (const job of batchJobs) {
            failedJobIds.push(job.id);
          }
        }
      } catch {
        for (const job of batchJobs) {
          failedJobIds.push(job.id);
        }
      }
    }

    // 2) 逐个删除其余终态任务（包括手动任务和未整批选中的 Smart Scan 子任务）。
    const terminalJobsForIndividualDelete = terminalJobsAllowed.filter(
      (job) => !job.batchId || !fullBatchIdsToDelete.has(job.batchId),
    );

    for (const job of terminalJobsForIndividualDelete) {
      try {
        const ok = await deleteTranscodeJob(job.id);
        if (!ok) {
          failedJobIds.push(job.id);
        }
      } catch {
        failedJobIds.push(job.id);
      }
    }

    // 不论删除是否全部成功，都刷新一次队列快照，让前端 UI 与后端状态保持一致。
    try {
      await refreshQueueFromBackend();
    } catch {
      queueError.value = (t("queue.error.deleteFailed") as string) ?? "Failed to delete some jobs from queue.";
      selectedJobIds.value = new Set();
      return;
    }

    if (failedJobIds.length > 0) {
      const currentJobs = jobs.value;
      const failedStillPresent = currentJobs.filter((job) => failedJobIds.includes(job.id));

      const failedTerminalStillPresent = failedStillPresent.filter((job) => isTerminalStatus(job.status));
      const failedNonTerminalNow = failedStillPresent.filter((job) => !isTerminalStatus(job.status));

      if (failedTerminalStillPresent.length > 0) {
        queueError.value = (t("queue.error.deleteFailed") as string) ?? "Failed to delete some jobs from queue.";
      } else if (failedNonTerminalNow.length > 0 || nonTerminalJobs.length > 0 || blockedBatchIds.size > 0) {
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
