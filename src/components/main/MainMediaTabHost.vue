<script setup lang="ts">
import { MediaPanel } from "@/components/main/lazyTabs";
import { useMainMediaTabOrchestrator } from "@/composables/main-app/orchestrators/useMainMediaTabOrchestrator";

const { panelProps, panelListeners } = useMainMediaTabOrchestrator();
</script>

<template>
  <MediaPanel v-bind="panelProps" v-on="panelListeners" />
</template>
