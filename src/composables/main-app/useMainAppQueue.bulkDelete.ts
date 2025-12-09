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

    const terminalJobs = selectedJobs.value.filter((job) => isTerminalStatus(job.status));
    const nonTerminalJobs = selectedJobs.value.filter((job) => !isTerminalStatus(job.status));

    if (!terminalJobs.length) {
      queueError.value =
        (t("queue.error.deleteActiveNotAllowed") as string) ??
        "Cannot delete jobs that are still running; please stop them first.";
      return;
    }

    if (!hasTauri()) {
      const deletableIds = new Set(terminalJobs.map((job) => job.id));
      jobs.value = jobs.value.filter((job) => !deletableIds.has(job.id));
      selectedJobIds.value = new Set();
      return;
    }

    const failedJobIds: string[] = [];
    for (const job of terminalJobs) {
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
      } else if (failedNonTerminalNow.length > 0 || nonTerminalJobs.length > 0) {
        queueError.value =
          (t("queue.error.deleteActiveNotAllowed") as string) ??
          "Cannot delete jobs that are still running; please stop them first.";
      } else {
        queueError.value = null;
      }
    } else if (nonTerminalJobs.length > 0) {
      queueError.value =
        (t("queue.error.deleteActiveNotAllowed") as string) ??
        "Cannot delete jobs that are still running; please stop them first.";
    } else {
      queueError.value = null;
    }

    selectedJobIds.value = new Set();
  };
}
