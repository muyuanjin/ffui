import type { Ref } from "vue";
import { deleteBatchCompressBatchesBulk, deleteTranscodeJobsBulk, hasTauri } from "@/lib/backend";
import { waitForQueueSnapshotRevision } from "@/composables/queue/waitForQueueUpdate";
import type { TranscodeJob } from "@/types";

interface CreateBulkDeleteOptions {
  jobs: Ref<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  selectedJobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  lastQueueSnapshotRevision: Ref<number | null>;
  refreshQueueFromBackend: () => Promise<void>;
  t: (key: string) => string;
}

const isTerminalStatus = (status: TranscodeJob["status"]) =>
  status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";

export function createBulkDelete(options: CreateBulkDeleteOptions) {
  const { jobs, selectedJobIds, selectedJobs, queueError, lastQueueSnapshotRevision, refreshQueueFromBackend, t } =
    options;

  return async () => {
    const selected = Array.from(selectedJobIds.value);
    if (!selected.length) return;

    // 预先按 batchId 分组，便于对 Batch Compress 批次进行完整性校验和批量删除。
    const jobsByBatchId = new Map<string, TranscodeJob[]>();
    for (const job of jobs.value) {
      if (!job.batchId) continue;
      const list = jobsByBatchId.get(job.batchId) ?? [];
      list.push(job);
      jobsByBatchId.set(job.batchId, list);
    }

    const terminalJobs = selectedJobs.value.filter((job) => isTerminalStatus(job.status));
    const nonTerminalJobs = selectedJobs.value.filter((job) => !isTerminalStatus(job.status));

    // 对 Batch Compress 批次：若该批次存在任意非终态子任务，则跳过该批次的删除，避免“部分删除”。
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

    // 进一步识别“整批选中”的 Batch Compress 批次：
    // 当某个 batchId 的所有子任务都处于终态且都在选中集内时，可以优先调用后端
    // delete_batch_compress_batch 一次性删除，避免对每个子任务单独发 N 个请求。
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

    // Tauri 模式下使用后端批量命令，避免逐条 IPC 往返与逐条 notify 导致的卡顿。
    const sinceRevision = lastQueueSnapshotRevision.value;
    const failedJobIds: string[] = [];
    let hadBackendFailure = false;
    const optimisticDeletedJobIds = new Set<string>();

    // 1) 批次级删除（Batch Compress 复合任务）。
    const batchIdsToDelete = Array.from(fullBatchIdsToDelete);
    if (batchIdsToDelete.length > 0) {
      try {
        const ok = await deleteBatchCompressBatchesBulk(batchIdsToDelete);
        if (!ok) {
          hadBackendFailure = true;
          for (const batchId of batchIdsToDelete) {
            const batchJobs = jobsByBatchId.get(batchId) ?? [];
            for (const job of batchJobs) {
              failedJobIds.push(job.id);
            }
          }
        } else {
          for (const batchId of batchIdsToDelete) {
            const batchJobs = jobsByBatchId.get(batchId) ?? [];
            for (const job of batchJobs) {
              optimisticDeletedJobIds.add(job.id);
            }
          }
        }
      } catch {
        hadBackendFailure = true;
        for (const batchId of batchIdsToDelete) {
          const batchJobs = jobsByBatchId.get(batchId) ?? [];
          for (const job of batchJobs) {
            failedJobIds.push(job.id);
          }
        }
      }
    }

    // 2) 批量删除其余终态任务（包括手动任务和未整批选中的 Batch Compress 子任务）。
    const terminalJobsForIndividualDelete = terminalJobsAllowed.filter(
      (job) => !job.batchId || !fullBatchIdsToDelete.has(job.batchId),
    );

    const jobIdsToDelete = terminalJobsForIndividualDelete.map((job) => job.id);
    if (jobIdsToDelete.length > 0) {
      try {
        const ok = await deleteTranscodeJobsBulk(jobIdsToDelete);
        if (!ok) {
          hadBackendFailure = true;
          failedJobIds.push(...jobIdsToDelete);
        } else {
          for (const jobId of jobIdsToDelete) {
            optimisticDeletedJobIds.add(jobId);
          }
        }
      } catch {
        hadBackendFailure = true;
        failedJobIds.push(...jobIdsToDelete);
      }
    }

    // UI-first: remove successfully deleted items immediately so "bulk delete" feels instant,
    // then rely on the next backend snapshot to confirm consistency.
    if (!hadBackendFailure && optimisticDeletedJobIds.size > 0) {
      jobs.value = jobs.value.filter((job) => !optimisticDeletedJobIds.has(job.id));
      selectedJobIds.value = new Set();
    }

    // 删除成功时优先等待后端推送的快照事件，避免额外的全量 refresh（大队列下会明显变慢）。
    // 如果后端未推送（或 IPC 丢失），再回退到 refreshQueueFromBackend 做一致性恢复。
    try {
      const preferRevision = typeof sinceRevision === "number" && Number.isFinite(sinceRevision);
      if (!hadBackendFailure && preferRevision) {
        const synced = await waitForQueueSnapshotRevision(lastQueueSnapshotRevision, { sinceRevision });
        if (synced) {
          // queue snapshot applied; continue with error/selection handling below
        } else {
          await refreshQueueFromBackend();
        }
      } else {
        await refreshQueueFromBackend();
      }
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
