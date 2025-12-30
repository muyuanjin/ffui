<script setup lang="ts">
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import { useMainQueueContextMenuOrchestrator } from "@/composables/main-app/orchestrators/useMainQueueContextMenuOrchestrator";

const { menuProps, menuListeners } = useMainQueueContextMenuOrchestrator();
</script>

<template>
  <QueueContextMenu v-bind="menuProps" v-on="menuListeners" />
</template>
