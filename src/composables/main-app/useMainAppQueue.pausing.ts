import { ref, watch, type Ref } from "vue";
import type { TranscodeJob } from "@/types";

export function usePausingJobIds(jobs: Ref<TranscodeJob[]>): Ref<Set<string>> {
  // UI-only: track jobs that have requested "wait/pause" but remain in
  // processing state until the backend reaches a safe point and marks them paused.
  const pausingJobIds = ref<Set<string>>(new Set());
  watch(
    jobs,
    (nextJobs) => {
      if (pausingJobIds.value.size === 0) return;
      const byId = new Map(nextJobs.map((job) => [job.id, job]));
      const next = new Set<string>();
      for (const id of pausingJobIds.value) {
        const job = byId.get(id);
        if (job && job.status === "processing") {
          next.add(id);
        }
      }
      if (next.size !== pausingJobIds.value.size) {
        pausingJobIds.value = next;
      }
    },
    { deep: false },
  );

  return pausingJobIds;
}
