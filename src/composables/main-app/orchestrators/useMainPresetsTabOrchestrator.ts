import { computed, proxyRefs } from "vue";
import { useDialogsDomain, usePresetsDomain } from "@/MainApp.setup";
import type { PresetSortMode, PresetViewMode } from "@/types";

export function useMainPresetsTabOrchestrator() {
  const dialogs = useDialogsDomain();
  const presetsDomain = usePresetsDomain();
  const presets = proxyRefs(presetsDomain);

  const panelProps = proxyRefs({
    presets: computed(() => presets.presets),
    presetSortMode: computed(() => presets.presetSortMode),
    presetViewMode: computed(() => presets.presetViewMode),
    presetSelectionBarPinned: computed(() => presets.presetSelectionBarPinned),
    setPresetSelectionBarPinned: presets.setPresetSelectionBarPinned,
    setPresetSortMode: (mode: PresetSortMode) => {
      presets.presetSortMode = mode;
    },
    setPresetViewMode: (mode: PresetViewMode) => {
      presets.presetViewMode = mode;
    },
    dialogManager: dialogs.dialogManager,
    presetsModule: presetsDomain,
  });

  return { panelProps };
}
