<script setup lang="ts">
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import { useMainWaitingJobContextMenuOrchestrator } from "@/composables/main-app/orchestrators/useMainWaitingJobContextMenuOrchestrator";

const { menuProps, menuListeners } = useMainWaitingJobContextMenuOrchestrator();
</script>

<template>
  <WaitingJobContextMenu v-bind="menuProps" v-on="menuListeners" />
</template>
