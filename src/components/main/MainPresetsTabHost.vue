<script setup lang="ts">
import { useMainPresetsTabOrchestrator } from "@/composables/main-app/orchestrators/useMainPresetsTabOrchestrator";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
const { panelProps } = useMainPresetsTabOrchestrator();
</script>

<template>
  <PresetTabPanel v-bind="panelProps" />
</template>
