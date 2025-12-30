<script setup lang="ts">
import { proxyRefs } from "vue";
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const queue = proxyRefs(context.queue);
const queueContextMenu = proxyRefs(context.queueContextMenu);
</script>

<template>
  <QueueContextMenu
    :visible="queueContextMenu.queueContextMenuVisible"
    :x="queueContextMenu.queueContextMenuX"
    :y="queueContextMenu.queueContextMenuY"
    :mode="queueContextMenu.queueContextMenuMode"
    :job-status="queueContextMenu.queueContextMenuJobStatus"
    :job-type="queueContextMenu.queueContextMenuJob?.type"
    :queue-mode="queue.queueMode"
    :has-selection="queue.hasSelection"
    :bulk-action-in-progress="queue.bulkActionInProgress"
    :can-reveal-input-path="queueContextMenu.queueContextMenuCanRevealInputPath"
    :can-reveal-output-path="queueContextMenu.queueContextMenuCanRevealOutputPath"
    @inspect="queueContextMenu.handleQueueContextInspect"
    @compare="queueContextMenu.handleQueueContextCompare"
    @wait="queueContextMenu.handleQueueContextWait"
    @resume="queueContextMenu.handleQueueContextResume"
    @restart="queueContextMenu.handleQueueContextRestart"
    @cancel="queueContextMenu.handleQueueContextCancel"
    @move-to-top="queueContextMenu.handleQueueContextMoveToTop"
    @move-to-bottom="queueContextMenu.handleQueueContextMoveToBottom"
    @remove="queueContextMenu.handleQueueContextDelete"
    @open-input-folder="queueContextMenu.handleQueueContextOpenInputFolder"
    @open-output-folder="queueContextMenu.handleQueueContextOpenOutputFolder"
    @copy-input-path="queueContextMenu.handleQueueContextCopyInputPath"
    @copy-output-path="queueContextMenu.handleQueueContextCopyOutputPath"
    @close="queueContextMenu.closeQueueContextMenu"
  />
</template>
