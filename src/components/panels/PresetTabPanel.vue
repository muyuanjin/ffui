<script setup lang="ts">
import type { Ref } from "vue";
import type { useDialogManager } from "@/composables";
import type { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import type { FFmpegPreset, PresetSortMode, PresetViewMode } from "@/types";

type DialogManager = ReturnType<typeof useDialogManager>;
type PresetsModule = ReturnType<typeof useMainAppPresets>;

type PresetsTabMainApp = {
  presets: Ref<FFmpegPreset[]>;
  presetSortMode: Ref<PresetSortMode>;
  presetViewMode: Ref<PresetViewMode>;
  presetSelectionBarPinned: Ref<boolean>;
  setPresetSelectionBarPinned: (pinned: boolean) => void;
  openPresetEditor: PresetsModule["openPresetEditor"];
  duplicatePreset: PresetsModule["duplicatePreset"];
  requestDeletePreset: PresetsModule["requestDeletePreset"];
  requestBatchDeletePresets: PresetsModule["requestBatchDeletePresets"];
  exportSelectedPresetsBundleToFile: PresetsModule["exportSelectedPresetsBundleToFile"];
  exportSelectedPresetsBundleToClipboard: PresetsModule["exportSelectedPresetsBundleToClipboard"];
  exportSelectedPresetsTemplateCommandsToClipboard: PresetsModule["exportSelectedPresetsTemplateCommandsToClipboard"];
  exportPresetToFile: PresetsModule["exportPresetToFile"];
  handleReorderPresets: PresetsModule["handleReorderPresets"];
  importPresetsBundleFromFile: PresetsModule["importPresetsBundleFromFile"];
  importPresetsBundleFromClipboard: PresetsModule["importPresetsBundleFromClipboard"];
  dialogManager: DialogManager;
};

const props = defineProps<{
  mainApp: PresetsTabMainApp;
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
