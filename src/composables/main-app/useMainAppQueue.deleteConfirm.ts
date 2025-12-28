import { computed, ref, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { isTerminalStatus } from "@/composables/queue/jobStatus";

type PendingQueueDelete = {
  selectedIds: string[];
};

export function createQueueDeleteConfirm(options: {
  jobs: Ref<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  bulkCancelSelectedJobs: () => Promise<void>;
  bulkDeleteTerminalSelection: () => Promise<void>;
}) {
  const { jobs, selectedJobIds, bulkCancelSelectedJobs, bulkDeleteTerminalSelection } = options;

  const pendingQueueDelete = ref<PendingQueueDelete | null>(null);
  const queueDeleteConfirmOpen = ref(false);

  const pendingSelectedJobs = computed(() => {
    const ids = pendingQueueDelete.value?.selectedIds ?? [];
    if (ids.length === 0) return [] as TranscodeJob[];
    const jobById = new Map(jobs.value.map((job) => [job.id, job] as const));
    return ids.map((id) => jobById.get(id)).filter((job): job is TranscodeJob => !!job);
  });

  const pendingTerminalIds = computed(() =>
    pendingSelectedJobs.value.filter((job) => isTerminalStatus(job.status)).map((j) => j.id),
  );
  const pendingActiveIds = computed(() =>
    pendingSelectedJobs.value.filter((job) => !isTerminalStatus(job.status)).map((j) => j.id),
  );

  const queueDeleteConfirmSelectedCount = computed(() => pendingQueueDelete.value?.selectedIds.length ?? 0);
  const queueDeleteConfirmTerminalCount = computed(() => pendingTerminalIds.value.length);
  const queueDeleteConfirmActiveCount = computed(() => pendingActiveIds.value.length);

  const cancelQueueDeleteConfirm = () => {
    queueDeleteConfirmOpen.value = false;
    pendingQueueDelete.value = null;
  };

  const applyTerminalDeleteAndRestoreSelection = async (terminalIdsNow: string[], activeIdsNow: string[]) => {
    pendingQueueDelete.value = null;

    if (terminalIdsNow.length > 0) {
      selectedJobIds.value = new Set(terminalIdsNow);
      await bulkDeleteTerminalSelection();
    }

    const stillPresent = new Set(jobs.value.map((job) => job.id));
    selectedJobIds.value = new Set(activeIdsNow.filter((id) => stillPresent.has(id)));
  };

  const bulkDeleteWithConfirm = async () => {
    const selectedIds = Array.from(selectedJobIds.value);
    if (selectedIds.length === 0) return;

    const jobById = new Map(jobs.value.map((job) => [job.id, job] as const));
    const selectedBefore = selectedIds.map((id) => jobById.get(id)).filter((job): job is TranscodeJob => !!job);
    if (selectedBefore.length === 0) return;

    const activeCount = selectedBefore.filter((job) => !isTerminalStatus(job.status)).length;
    if (activeCount > 0) {
      pendingQueueDelete.value = {
        selectedIds: selectedBefore.map((job) => job.id),
      };
      queueDeleteConfirmOpen.value = true;
      return;
    }

    await bulkDeleteTerminalSelection();
  };

  const confirmQueueDeleteTerminalOnly = async () => {
    if (!pendingQueueDelete.value) return;
    queueDeleteConfirmOpen.value = false;

    const terminalIdsNow = pendingTerminalIds.value;
    const activeIdsNow = pendingActiveIds.value;
    await applyTerminalDeleteAndRestoreSelection(terminalIdsNow, activeIdsNow);
  };

  const confirmQueueDeleteCancelAndDelete = async () => {
    const pending = pendingQueueDelete.value;
    if (!pending) return;
    queueDeleteConfirmOpen.value = false;

    selectedJobIds.value = new Set(pending.selectedIds);
    await bulkCancelSelectedJobs();

    const terminalIdsNow = pendingTerminalIds.value;
    const activeIdsNow = pendingActiveIds.value;
    await applyTerminalDeleteAndRestoreSelection(terminalIdsNow, activeIdsNow);
  };

  return {
    bulkDeleteWithConfirm,
    queueDeleteConfirmOpen,
    queueDeleteConfirmSelectedCount,
    queueDeleteConfirmTerminalCount,
    queueDeleteConfirmActiveCount,
    confirmQueueDeleteCancelAndDelete,
    confirmQueueDeleteTerminalOnly,
    cancelQueueDeleteConfirm,
  };
}
