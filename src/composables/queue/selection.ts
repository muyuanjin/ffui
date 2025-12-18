import type { ComputedRef, Ref } from "vue";
import type { TranscodeJob } from "@/types";

export function createSelectionHelpers(selectedJobIds: Ref<Set<string>>, filteredJobs: ComputedRef<TranscodeJob[]>) {
  const isJobSelected = (jobId: string): boolean => selectedJobIds.value.has(jobId);

  const toggleJobSelected = (jobId: string) => {
    if (!jobId) return;
    const next = new Set(selectedJobIds.value);
    if (next.has(jobId)) {
      next.delete(jobId);
    } else {
      next.add(jobId);
    }
    selectedJobIds.value = next;
  };

  const clearSelection = () => {
    if (selectedJobIds.value.size === 0) return;
    selectedJobIds.value = new Set();
  };

  const selectAllVisibleJobs = () => {
    const ids = filteredJobs.value.map((job) => job.id);
    selectedJobIds.value = new Set(ids);
  };

  const invertSelection = () => {
    const visibleIds = new Set(filteredJobs.value.map((job) => job.id));
    const next = new Set<string>();
    for (const id of visibleIds) {
      if (!selectedJobIds.value.has(id)) {
        next.add(id);
      }
    }
    selectedJobIds.value = next;
  };

  return {
    isJobSelected,
    toggleJobSelected,
    clearSelection,
    selectAllVisibleJobs,
    invertSelection,
  };
}
