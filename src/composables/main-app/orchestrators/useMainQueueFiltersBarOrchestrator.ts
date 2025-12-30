import { computed, proxyRefs } from "vue";
import { useQueueDomain, useShellDomain } from "@/MainApp.setup";
import type { QueueSortDirection, QueueSortField } from "@/composables";
import type { QueueMode } from "@/types";

export function useMainQueueFiltersBarOrchestrator() {
  const shell = proxyRefs(useShellDomain());
  const queue = proxyRefs(useQueueDomain());

  const barVisible = computed(() => shell.activeTab === "queue");

  const barProps = proxyRefs({
    activeStatusFilters: computed(() => queue.activeStatusFilters),
    activeTypeFilters: computed(() => queue.activeTypeFilters),
    filterText: computed(() => queue.filterText),
    filterUseRegex: computed(() => queue.filterUseRegex),
    filterRegexError: computed(() => queue.filterRegexError),
    sortPrimary: computed(() => queue.sortPrimary),
    sortPrimaryDirection: computed(() => queue.sortPrimaryDirection),
    sortSecondary: computed(() => queue.sortSecondary),
    sortSecondaryDirection: computed(() => queue.sortSecondaryDirection),
    hasPrimarySortTies: computed(() => queue.hasPrimarySortTies),
    hasActiveFilters: computed(() => queue.hasActiveFilters),
    hasSelection: computed(() => queue.hasSelection),
    selectedCount: computed(() => queue.selectedJobIds.size),
    queueMode: computed(() => queue.queueMode),
    visibleCount: computed(() => queue.queueJobsForDisplay.length),
    totalCount: computed(() => queue.queueTotalCount),
    selectionBarPinned: computed(() => queue.selectionBarPinned),
    bulkActionInProgress: computed(() => queue.bulkActionInProgress),
  });

  const barListeners = {
    "update:queueMode": (value: QueueMode) => queue.setQueueMode(value),
    "toggle-status-filter": queue.toggleStatusFilter,
    "toggle-type-filter": queue.toggleTypeFilter,
    "update:filterText": (value: string) => {
      queue.filterText = value;
    },
    "toggle-filter-regex-mode": queue.toggleFilterRegexMode,
    "reset-queue-filters": queue.resetQueueFilters,
    "update:sortPrimary": (value: QueueSortField) => {
      queue.sortPrimary = value;
    },
    "update:sortPrimaryDirection": (value: QueueSortDirection) => {
      queue.sortPrimaryDirection = value;
    },
    "update:sortSecondary": (value: QueueSortField) => {
      queue.sortSecondary = value;
    },
    "update:sortSecondaryDirection": (value: QueueSortDirection) => {
      queue.sortSecondaryDirection = value;
    },
    "select-all-visible-jobs": queue.selectAllVisibleJobs,
    "invert-selection": queue.invertSelection,
    "clear-selection": queue.clearSelection,
    "bulk-cancel": queue.bulkCancel,
    "bulk-wait": queue.bulkWait,
    "bulk-resume": queue.bulkResume,
    "bulk-restart": queue.bulkRestart,
    "bulk-move-to-top": queue.bulkMoveToTop,
    "bulk-move-to-bottom": queue.bulkMoveToBottom,
    "bulk-delete": queue.bulkDelete,
    "update:selectionBarPinned": queue.setSelectionBarPinned,
  } as const;

  return { barVisible, barProps, barListeners };
}
