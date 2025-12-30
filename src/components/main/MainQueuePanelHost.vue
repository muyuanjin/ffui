<script setup lang="ts">
import { proxyRefs } from "vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import { useQueueDomain, useShellDomain } from "@/MainApp.setup";
import { useQueuePanelOrchestrator } from "@/composables/main-app/orchestrators/useQueuePanelOrchestrator";

const shell = proxyRefs(useShellDomain());
const queue = proxyRefs(useQueueDomain());
const orchestrator = useQueuePanelOrchestrator();
</script>

<template>
  <div v-if="shell.activeTab === 'queue'" class="flex-1 min-h-0 flex flex-col">
    <div class="p-4 flex-1 min-h-0 flex flex-col">
      <QueuePanel
        v-bind="queue.queuePanelProps"
        @update:queue-view-mode="queue.setQueueViewMode"
        @update:queue-mode="queue.setQueueMode"
        @update:queue-progress-style="queue.setQueueProgressStyle"
        @add-job-files="orchestrator.addManualJobsFromFiles"
        @add-job-folder="orchestrator.addManualJobsFromFolder"
        @cancel-job="queue.handleCancelJob"
        @wait-job="queue.handleWaitJob"
        @resume-job="queue.handleResumeJob"
        @restart-job="queue.handleRestartJob"
        @toggle-job-selected="queue.toggleJobSelected"
        @inspect-job="orchestrator.inspectJob"
        @preview-job="orchestrator.previewJob"
        @compare-job="orchestrator.compareJob"
        @toggle-batch-expanded="orchestrator.toggleBatchExpanded"
        @open-batch-detail="orchestrator.openBatchDetail"
        @open-job-context-menu="orchestrator.openJobContextMenu"
        @open-bulk-context-menu="orchestrator.openBulkContextMenu"
      />
    </div>
  </div>
</template>
