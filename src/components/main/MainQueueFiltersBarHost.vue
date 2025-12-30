<script setup lang="ts">
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import { useMainQueueFiltersBarOrchestrator } from "@/composables/main-app/orchestrators/useMainQueueFiltersBarOrchestrator";

const { barVisible, barProps, barListeners } = useMainQueueFiltersBarOrchestrator();
</script>

<template>
  <QueueFiltersBar v-if="barVisible" v-bind="barProps" v-on="barListeners" />
</template>
