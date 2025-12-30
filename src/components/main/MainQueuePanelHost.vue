<script setup lang="ts">
import { proxyRefs } from "vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const shell = proxyRefs(context.shell);
const queue = proxyRefs(context.queue);
</script>

<template>
  <div v-if="shell.activeTab === 'queue'" class="flex-1 min-h-0 flex flex-col">
    <div class="p-4 flex-1 min-h-0 flex flex-col">
      <QueuePanel
        v-bind="queue.queuePanelProps"
        @update:queue-view-mode="queue.setQueueViewMode"
        @update:queue-mode="queue.setQueueMode"
        @update:queue-progress-style="queue.setQueueProgressStyle"
        @add-job-files="context.presetsModule.addManualJob('files')"
        @add-job-folder="context.presetsModule.addManualJob('folder')"
        @cancel-job="queue.handleCancelJob"
        @wait-job="queue.handleWaitJob"
        @resume-job="queue.handleResumeJob"
        @restart-job="queue.handleRestartJob"
        @toggle-job-selected="queue.toggleJobSelected"
        @inspect-job="context.dialogs.dialogManager.openJobDetail"
        @preview-job="context.preview.openJobPreviewFromQueue"
        @compare-job="context.dialogs.dialogManager.openJobCompare"
        @toggle-batch-expanded="context.batchCompress.toggleBatchExpanded"
        @open-batch-detail="context.preview.openBatchDetail"
        @open-job-context-menu="context.queueContextMenu.openQueueContextMenuForJob"
        @open-bulk-context-menu="context.queueContextMenu.openQueueContextMenuForBulk"
      />
    </div>
  </div>
</template>
