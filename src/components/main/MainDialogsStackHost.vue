<script setup lang="ts">
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";
import { useMainDialogsStackOrchestrator } from "@/composables/main-app/orchestrators/useMainDialogsStackOrchestrator";

const emit = defineEmits<{
  (e: "openToolsSettings"): void;
}>();
const { stackProps, stackListeners } = useMainDialogsStackOrchestrator();
</script>

<template>
  <MainDialogsStack v-bind="stackProps" v-on="stackListeners" @openToolsSettings="emit('openToolsSettings')" />
</template>
