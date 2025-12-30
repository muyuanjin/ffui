<script setup lang="ts">
import { SettingsPanel } from "@/components/main/lazyTabs";
import { useMainSettingsTabOrchestrator } from "@/composables/main-app/orchestrators/useMainSettingsTabOrchestrator";

const { panelProps, panelListeners } = useMainSettingsTabOrchestrator();
</script>

<template>
  <SettingsPanel v-bind="panelProps" v-on="panelListeners" />
</template>
