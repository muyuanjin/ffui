<script setup lang="ts">
import type { useDialogManager } from "@/composables";
import type { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import PresetVmafMeasureDialog from "@/components/dialogs/PresetVmafMeasureDialog.vue";
import { Button } from "@/components/ui/button";
import { hasTauri } from "@/lib/backend";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset, PresetCardFooterSettings, PresetSortMode, PresetViewMode } from "@/types";

type DialogManager = ReturnType<typeof useDialogManager>;
type PresetsModule = ReturnType<typeof useMainAppPresets>;

const props = defineProps<{
  presets: FFmpegPreset[];
  presetSortMode: PresetSortMode;
  presetViewMode: PresetViewMode;
  presetSelectionBarPinned: boolean;
  presetCardFooter: PresetCardFooterSettings | null;
  vmafMeasureReferencePath: string;
  setVmafMeasureReferencePath: (path: string) => void;
  ensureAppSettingsLoaded: () => Promise<void>;
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

const { t } = useI18n();
const vmafDialogOpen = ref(false);
</script>

<template>
  <PresetPanel
    :presets="props.presets"
    :sort-mode="props.presetSortMode"
    :view-mode="props.presetViewMode"
    :selection-bar-pinned="props.presetSelectionBarPinned"
    :preset-card-footer="props.presetCardFooter"
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
  >
    <template #toolbar-actions>
      <Button size="sm" variant="outline" class="h-7 px-3" :disabled="!hasTauri()" @click="vmafDialogOpen = true">
        {{ t("presets.vmafMeasureOpen") }}
      </Button>
    </template>
  </PresetPanel>

  <PresetVmafMeasureDialog
    :open="vmafDialogOpen"
    :presets="props.presets"
    :reload-presets="props.presetsModule.reloadPresets"
    :vmaf-measure-reference-path="props.vmafMeasureReferencePath"
    :set-vmaf-measure-reference-path="props.setVmafMeasureReferencePath"
    :ensure-app-settings-loaded="props.ensureAppSettingsLoaded"
    @update:open="vmafDialogOpen = $event"
  />
</template>
