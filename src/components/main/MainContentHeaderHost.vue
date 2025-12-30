<script setup lang="ts">
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import { useMainContentHeaderOrchestrator } from "@/composables/main-app/orchestrators/useMainContentHeaderOrchestrator";

const { headerProps, headerListeners } = useMainContentHeaderOrchestrator();
</script>

<template>
  <MainContentHeader v-bind="headerProps" v-on="headerListeners" />
</template>
