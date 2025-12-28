import { computed, ref, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { isTerminalStatus } from "@/composables/queue/jobStatus";
import { waitForQueueUpdate } from "@/composables/queue/waitForQueueUpdate";

type PendingQueueDelete = {
  selectedIds: string[];
};

export function createQueueDeleteConfirm(options: {
  jobs: Ref<TranscodeJob[]>;
  selectedJobIds: Ref<Set<string>>;
  lastQueueSnapshotAtMs: Ref<number | null>;
  refreshQueueFromBackend: () => Promise<void>;
  bulkCancelSelectedJobs: () => Promise<void>;
  bulkDeleteTerminalSelection: () => Promise<void>;
}) {
  const {
    jobs,
    selectedJobIds,
    lastQueueSnapshotAtMs,
    refreshQueueFromBackend,
    bulkCancelSelectedJobs,
    bulkDeleteTerminalSelection,
  } = options;

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

    const activeIdsBeforeCancel = pendingActiveIds.value;
    const hadProcessingBeforeCancel = pendingSelectedJobs.value.some((job) => job.status === "processing");

    selectedJobIds.value = new Set(pending.selectedIds);
    await bulkCancelSelectedJobs();

    // Ensure cooperative cancellations (processing -> cancelled) are observed before deletion.
    // We intentionally sync with backend snapshots so we don't rely on optimistic UI statuses.
    if (hadProcessingBeforeCancel) {
      try {
        await refreshQueueFromBackend();
      } catch {
        // Best-effort: we can still rely on queue events / later refreshes.
      }
    }

    const isTestEnv =
      typeof import.meta !== "undefined" &&
      typeof import.meta.env !== "undefined" &&
      (import.meta.env as { MODE?: string }).MODE === "test";

    const totalTimeoutMs = isTestEnv ? 600 : 30_000;
    const stepTimeoutMs = isTestEnv ? 50 : 1_500;

    const startMs = Date.now();
    let sinceMs: number | null = lastQueueSnapshotAtMs.value;
    let refreshedAfterTimeout = false;

    while (Date.now() - startMs < totalTimeoutMs) {
      const byId = new Map(jobs.value.map((job) => [job.id, job] as const));
      const stillActive = activeIdsBeforeCancel.filter((id) => {
        const job = byId.get(id);
        return job != null && !isTerminalStatus(job.status);
      });
      if (stillActive.length === 0) break;

      const updated = await waitForQueueUpdate(lastQueueSnapshotAtMs, { sinceMs, timeoutMs: stepTimeoutMs });
      sinceMs = lastQueueSnapshotAtMs.value;
      if (updated) {
        refreshedAfterTimeout = false;
        continue;
      }

      // Fall back to an explicit refresh if we didn't receive queue events.
      // Avoid tight refresh loops by only retrying after at least one timeout.
      if (!refreshedAfterTimeout) {
        refreshedAfterTimeout = true;
        try {
          await refreshQueueFromBackend();
        } catch {
          // keep waiting
        }
        sinceMs = lastQueueSnapshotAtMs.value;
      }
    }

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
