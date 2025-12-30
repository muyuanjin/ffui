<script setup lang="ts">
import { proxyRefs } from "vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import { useQueueDomain } from "@/MainApp.setup";

const queue = useQueueDomain();
const dnd = proxyRefs(queue.dnd);
</script>

<template>
  <WaitingJobContextMenu
    :visible="dnd.waitingJobContextMenuVisible"
    @move-to-top="dnd.handleWaitingJobContextMoveToTop"
    @close="dnd.closeWaitingJobContextMenu"
  />
</template>
