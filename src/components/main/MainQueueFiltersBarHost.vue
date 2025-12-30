<script setup lang="ts">
import { proxyRefs } from "vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const shell = proxyRefs(context.shell);
const queue = proxyRefs(context.queue);
</script>

<template>
  <QueueFiltersBar
    v-if="shell.activeTab === 'queue'"
    :active-status-filters="queue.activeStatusFilters"
    :active-type-filters="queue.activeTypeFilters"
    :filter-text="queue.filterText"
    :filter-use-regex="queue.filterUseRegex"
    :filter-regex-error="queue.filterRegexError"
    :sort-primary="queue.sortPrimary"
    :sort-primary-direction="queue.sortPrimaryDirection"
    :sort-secondary="queue.sortSecondary"
    :sort-secondary-direction="queue.sortSecondaryDirection"
    :has-primary-sort-ties="queue.hasPrimarySortTies"
    :has-active-filters="queue.hasActiveFilters"
    :has-selection="queue.hasSelection"
    :selected-count="queue.selectedJobIds.size"
    :queue-mode="queue.queueMode"
    :visible-count="queue.queueJobsForDisplay.length"
    :total-count="queue.queueTotalCount"
    :selection-bar-pinned="queue.selectionBarPinned"
    :bulk-action-in-progress="queue.bulkActionInProgress"
    @update:queueMode="queue.setQueueMode"
    @toggle-status-filter="queue.toggleStatusFilter"
    @toggle-type-filter="queue.toggleTypeFilter"
    @update:filterText="(v) => (queue.filterText = v)"
    @toggle-filter-regex-mode="queue.toggleFilterRegexMode"
    @reset-queue-filters="queue.resetQueueFilters"
    @update:sortPrimary="(v) => (queue.sortPrimary = v)"
    @update:sortPrimaryDirection="(v) => (queue.sortPrimaryDirection = v)"
    @update:sortSecondary="(v) => (queue.sortSecondary = v)"
    @update:sortSecondaryDirection="(v) => (queue.sortSecondaryDirection = v)"
    @select-all-visible-jobs="queue.selectAllVisibleJobs"
    @invert-selection="queue.invertSelection"
    @clear-selection="queue.clearSelection"
    @bulk-cancel="queue.bulkCancel"
    @bulk-wait="queue.bulkWait"
    @bulk-resume="queue.bulkResume"
    @bulk-restart="queue.bulkRestart"
    @bulk-move-to-top="queue.bulkMoveToTop"
    @bulk-move-to-bottom="queue.bulkMoveToBottom"
    @bulk-delete="queue.bulkDelete"
    @update:selectionBarPinned="queue.setSelectionBarPinned"
  />
</template>
