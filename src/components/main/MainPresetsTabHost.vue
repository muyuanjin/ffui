<script setup lang="ts">
import { proxyRefs } from "vue";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
import { useMainAppContext } from "@/MainApp.setup";

const context = useMainAppContext();
const app = proxyRefs(context);
</script>

<template>
  <PresetTabPanel
    :presets="app.presets"
    :preset-sort-mode="app.presetSortMode"
    :preset-view-mode="app.presetViewMode"
    :preset-selection-bar-pinned="app.presetSelectionBarPinned"
    :set-preset-selection-bar-pinned="app.setPresetSelectionBarPinned"
    :set-preset-sort-mode="(v) => (app.presetSortMode = v)"
    :set-preset-view-mode="(v) => (app.presetViewMode = v)"
    :dialog-manager="context.dialogs.dialogManager"
    :presets-module="context.presetsModule"
  />
</template>
