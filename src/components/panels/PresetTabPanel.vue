<script setup lang="ts">
import type { MainAppSetup } from "@/composables/main-app/useMainAppSetup";
import PresetPanel from "@/components/panels/PresetPanel.vue";

type MainApp = MainAppSetup["mainApp"];

const props = defineProps<{
  mainApp: MainApp;
}>();

const {
  presets,
  presetSortMode,
  presetViewMode,
  presetSelectionBarPinned,
  setPresetSelectionBarPinned,
  openPresetEditor,
  duplicatePreset,
  requestDeletePreset,
  requestBatchDeletePresets,
  exportSelectedPresetsBundleToFile,
  exportSelectedPresetsBundleToClipboard,
  exportSelectedPresetsTemplateCommandsToClipboard,
  exportPresetToFile,
  handleReorderPresets,
  importPresetsBundleFromFile,
  importPresetsBundleFromClipboard,
  dialogManager,
} = props.mainApp;
</script>

<template>
  <PresetPanel
    :presets="presets"
    :sort-mode="presetSortMode"
    :view-mode="presetViewMode"
    :selection-bar-pinned="presetSelectionBarPinned"
    @update:selectionBarPinned="setPresetSelectionBarPinned"
    @edit="openPresetEditor"
    @duplicate="duplicatePreset"
    @delete="requestDeletePreset"
    @batchDelete="requestBatchDeletePresets"
    @exportSelectedToFile="exportSelectedPresetsBundleToFile"
    @exportSelectedToClipboard="exportSelectedPresetsBundleToClipboard"
    @exportSelectedCommandsToClipboard="exportSelectedPresetsTemplateCommandsToClipboard"
    @exportPresetToFile="exportPresetToFile"
    @reorder="handleReorderPresets"
    @importSmartPack="dialogManager.openSmartPresetImport()"
    @importBundle="importPresetsBundleFromFile"
    @importBundleFromClipboard="importPresetsBundleFromClipboard"
    @importCommands="dialogManager.openImportCommands()"
    @update:sortMode="(v) => (presetSortMode = v)"
    @update:viewMode="(v) => (presetViewMode = v)"
  />
</template>
