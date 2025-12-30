<script setup lang="ts">
import { proxyRefs } from "vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const dnd = proxyRefs(context.dnd);
</script>

<template>
  <WaitingJobContextMenu
    :visible="dnd.waitingJobContextMenuVisible"
    @move-to-top="dnd.handleWaitingJobContextMoveToTop"
    @close="dnd.closeWaitingJobContextMenu"
  />
</template>
