<script setup lang="ts">
import { proxyRefs } from "vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const app = proxyRefs(context);
const shell = proxyRefs(context.shell);
const queue = proxyRefs(context.queue);
</script>

<template>
  <MainContentHeader
    :active-tab="shell.activeTab"
    :current-title="app.currentTitle"
    :current-subtitle="app.currentSubtitle"
    :jobs-length="app.jobs.length"
    :completed-count="app.completedCount"
    :manual-job-preset-id="app.manualJobPresetId"
    :presets="app.presets"
    :queue-view-mode-model="queue.queueViewModeModel"
    :preset-sort-mode="app.presetSortMode"
    :queue-output-policy="queue.queueOutputPolicy"
    :carousel-auto-rotation-speed="queue.carouselAutoRotationSpeed"
    @update:manualJobPresetId="(v) => (app.manualJobPresetId = v)"
    @update:queueViewModeModel="(v) => (queue.queueViewModeModel = v)"
    @update:queueOutputPolicy="(v) => queue.setQueueOutputPolicy(v)"
    @update:carouselAutoRotationSpeed="(v) => queue.setCarouselAutoRotationSpeed(v)"
    @openPresetWizard="context.dialogs.dialogManager.openWizard()"
  />
</template>
