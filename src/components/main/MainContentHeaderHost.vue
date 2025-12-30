<script setup lang="ts">
import { proxyRefs } from "vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import { useDialogsDomain, usePresetsDomain, useQueueDomain, useShellDomain } from "@/MainApp.setup";

const dialogs = useDialogsDomain();
const shell = proxyRefs(useShellDomain());
const queue = proxyRefs(useQueueDomain());
const presets = proxyRefs(usePresetsDomain());
</script>

<template>
  <MainContentHeader
    :active-tab="shell.activeTab"
    :current-title="shell.currentTitle"
    :current-subtitle="shell.currentSubtitle"
    :jobs-length="queue.jobs.length"
    :completed-count="queue.completedCount"
    :manual-job-preset-id="presets.manualJobPresetId"
    :presets="presets.presets"
    :queue-view-mode-model="queue.queueViewModeModel"
    :preset-sort-mode="presets.presetSortMode"
    :queue-output-policy="queue.queueOutputPolicy"
    :carousel-auto-rotation-speed="queue.carouselAutoRotationSpeed"
    @update:manualJobPresetId="(v) => (presets.manualJobPresetId = v)"
    @update:queueViewModeModel="(v) => (queue.queueViewModeModel = v)"
    @update:queueOutputPolicy="(v) => queue.setQueueOutputPolicy(v)"
    @update:carouselAutoRotationSpeed="(v) => queue.setCarouselAutoRotationSpeed(v)"
    @openPresetWizard="dialogs.dialogManager.openWizard()"
  />
</template>
