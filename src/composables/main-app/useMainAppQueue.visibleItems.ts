import { computed, type ComputedRef, type Ref } from "vue";
import type { CompositeBatchCompressTask, QueueMode, TranscodeJob } from "@/types";
import type { QueueListItem } from "@/composables";
import { compareJobsInWaitingGroup, isTerminalStatus, isWaitingStatus } from "./useMainAppQueue.waiting";

export function createQueueVisibleItems(options: {
  queueMode: Ref<QueueMode>;
  filteredJobs: ComputedRef<TranscodeJob[]>;
  displayModeSortedJobs: ComputedRef<TranscodeJob[]>;
  manualQueueJobs: ComputedRef<TranscodeJob[]>;
  queueModeProcessingJobs: ComputedRef<TranscodeJob[]>;
  compositeBatchCompressTasks: ComputedRef<CompositeBatchCompressTask[]>;
  compositeTasksById: ComputedRef<Map<string, CompositeBatchCompressTask>>;
  batchMatchesFilters: (batch: CompositeBatchCompressTask) => boolean;
  compareJobsByConfiguredFields: (a: TranscodeJob, b: TranscodeJob) => number;
}) {
  const {
    queueMode,
    filteredJobs,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    compositeBatchCompressTasks,
    compositeTasksById,
    batchMatchesFilters,
    compareJobsByConfiguredFields,
  } = options;

  const queueModeWaitingItems = computed<QueueListItem[]>(() => {
    if (queueMode.value !== "queue") return [];

    const waitingJobs = filteredJobs.value
      .filter((job) => isWaitingStatus(job.status))
      .slice()
      .sort((a, b) => compareJobsInWaitingGroup(a, b, compareJobsByConfiguredFields));

    const items: QueueListItem[] = [];
    const renderedBatchIds = new Set<string>();

    for (const job of waitingJobs) {
      const batchId = job.batchId;
      if (batchId) {
        if (renderedBatchIds.has(batchId)) continue;
        const batch = compositeTasksById.value.get(batchId);
        if (batch && batchMatchesFilters(batch)) {
          items.push({ kind: "batch", batch });
          renderedBatchIds.add(batchId);
        }
        continue;
      }
      items.push({ kind: "job", job });
    }

    return items;
  });

  const queueModeWaitingBatchIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    for (const item of queueModeWaitingItems.value) {
      if (item.kind === "batch") ids.add(item.batch.batchId);
    }
    return ids;
  });

  const visibleQueueItems = computed<QueueListItem[]>(() => {
    const items: QueueListItem[] = [];

    if (queueMode.value === "queue") {
      // Queue mode: always include processing items for icon/carousel views.
      for (const job of queueModeProcessingJobs.value) {
        items.push({ kind: "job", job });
      }
      const waitingItems = queueModeWaitingItems.value;
      const waitingBatchIds = queueModeWaitingBatchIds.value;
      items.push(...waitingItems);

      for (const batch of compositeBatchCompressTasks.value) {
        if (waitingBatchIds.has(batch.batchId)) continue;
        if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
      }

      for (const job of displayModeSortedJobs.value) {
        if (job.batchId) continue;
        if (isTerminalStatus(job.status)) items.push({ kind: "job", job });
      }

      return items;
    }

    for (const batch of compositeBatchCompressTasks.value) {
      if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
    }
    for (const job of displayModeSortedJobs.value) {
      if (!job.batchId) items.push({ kind: "job", job });
    }
    return items;
  });

  const iconViewItems = computed<QueueListItem[]>(() => visibleQueueItems.value);

  const queueJobsForDisplay = computed<TranscodeJob[]>(() =>
    queueMode.value === "queue" ? manualQueueJobs.value : displayModeSortedJobs.value,
  );

  return {
    queueModeWaitingItems,
    queueModeWaitingBatchIds,
    visibleQueueItems,
    iconViewItems,
    queueJobsForDisplay,
  };
}
