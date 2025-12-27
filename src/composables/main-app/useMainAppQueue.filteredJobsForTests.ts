import { computed, type ComputedRef, type Ref } from "vue";
import type { QueueMode, TranscodeJob } from "@/types";

export function buildFilteredJobsForTests(options: {
  queueMode: Ref<QueueMode>;
  manualQueueJobs: ComputedRef<TranscodeJob[]>;
  displayModeSortedJobs: ComputedRef<TranscodeJob[]>;
  queueModeProcessingJobs: ComputedRef<TranscodeJob[]>;
  queueModeWaitingJobs: ComputedRef<TranscodeJob[]>;
}): ComputedRef<TranscodeJob[]> {
  const { queueMode, manualQueueJobs, displayModeSortedJobs, queueModeProcessingJobs, queueModeWaitingJobs } = options;

  return computed(() => {
    if (queueMode.value === "queue") {
      const processing = queueModeProcessingJobs.value;
      const waiting = queueModeWaitingJobs.value;
      const waitingIds = new Set(waiting.map((job) => job.id));
      const processingIds = new Set(processing.map((job) => job.id));
      const others = manualQueueJobs.value.filter((job) => !waitingIds.has(job.id) && !processingIds.has(job.id));
      return [...processing, ...waiting, ...others];
    }
    return displayModeSortedJobs.value;
  });
}
