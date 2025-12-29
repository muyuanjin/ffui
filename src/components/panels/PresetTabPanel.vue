<script setup lang="ts">
import type { useDialogManager } from "@/composables";
import type { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import type { FFmpegPreset, PresetSortMode, PresetViewMode } from "@/types";

type DialogManager = ReturnType<typeof useDialogManager>;
type PresetsModule = ReturnType<typeof useMainAppPresets>;

const props = defineProps<{
  presets: FFmpegPreset[];
  presetSortMode: PresetSortMode;
  presetViewMode: PresetViewMode;
  presetSelectionBarPinned: boolean;
  setPresetSelectionBarPinned: (pinned: boolean) => void;
  setPresetSortMode: (mode: PresetSortMode) => void;
  setPresetViewMode: (mode: PresetViewMode) => void;
  dialogManager: DialogManager;
  presetsModule: PresetsModule;
}>();

const {
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
} = props.presetsModule;
</script>

<template>
  <PresetPanel
    :presets="props.presets"
    :sort-mode="props.presetSortMode"
    :view-mode="props.presetViewMode"
    :selection-bar-pinned="props.presetSelectionBarPinned"
    @update:selectionBarPinned="props.setPresetSelectionBarPinned"
    @edit="openPresetEditor"
    @duplicate="duplicatePreset"
    @delete="requestDeletePreset"
    @batchDelete="requestBatchDeletePresets"
    @exportSelectedToFile="exportSelectedPresetsBundleToFile"
    @exportSelectedToClipboard="exportSelectedPresetsBundleToClipboard"
    @exportSelectedCommandsToClipboard="exportSelectedPresetsTemplateCommandsToClipboard"
    @exportPresetToFile="exportPresetToFile"
    @reorder="handleReorderPresets"
    @importSmartPack="props.dialogManager.openSmartPresetImport()"
    @importBundle="importPresetsBundleFromFile"
    @importBundleFromClipboard="importPresetsBundleFromClipboard"
    @importCommands="props.dialogManager.openImportCommands()"
    @update:sortMode="props.setPresetSortMode"
    @update:viewMode="props.setPresetViewMode"
  />
</template>
