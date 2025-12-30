<script setup lang="ts">
import { proxyRefs } from "vue";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
import { useDialogsDomain, usePresetsDomain } from "@/MainApp.setup";

const dialogs = useDialogsDomain();
const presetsDomain = usePresetsDomain();
const presets = proxyRefs(presetsDomain);
</script>

<template>
  <PresetTabPanel
    :presets="presets.presets"
    :preset-sort-mode="presets.presetSortMode"
    :preset-view-mode="presets.presetViewMode"
    :preset-selection-bar-pinned="presets.presetSelectionBarPinned"
    :set-preset-selection-bar-pinned="presets.setPresetSelectionBarPinned"
    :set-preset-sort-mode="(v) => (presets.presetSortMode = v)"
    :set-preset-view-mode="(v) => (presets.presetViewMode = v)"
    :dialog-manager="dialogs.dialogManager"
    :presets-module="presetsDomain"
  />
</template>
