<script setup lang="ts">
import QueuePanel from "@/components/panels/QueuePanel.vue";
import { useMainQueuePanelHostOrchestrator } from "@/composables/main-app/orchestrators/useMainQueuePanelHostOrchestrator";

const { panelVisible, panelProps, panelListeners } = useMainQueuePanelHostOrchestrator();
</script>

<template>
  <div v-if="panelVisible" class="flex-1 min-h-0 flex flex-col">
    <div class="p-4 flex-1 min-h-0 flex flex-col">
      <QueuePanel v-bind="panelProps" v-on="panelListeners" />
    </div>
  </div>
</template>
