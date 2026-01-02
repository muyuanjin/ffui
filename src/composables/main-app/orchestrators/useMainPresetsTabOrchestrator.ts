import { computed, proxyRefs } from "vue";
import { useDialogsDomain, usePresetsDomain, useSettingsDomain } from "@/MainApp.setup";
import type {
  AppSettings,
  PresetCardFooterSettings,
  PresetSortDirection,
  PresetSortMode,
  PresetViewMode,
} from "@/types";

export function useMainPresetsTabOrchestrator() {
  const dialogs = useDialogsDomain();
  const presetsDomain = usePresetsDomain();
  const settings = useSettingsDomain();
  const presets = proxyRefs(presetsDomain);

  const presetCardFooter = computed<PresetCardFooterSettings | null>(
    () => settings.appSettings.value?.presetCardFooter ?? null,
  );

  const vmafMeasureReferencePath = computed(() => settings.appSettings.value?.vmafMeasureReferencePath ?? "");

  const setVmafMeasureReferencePath = (path: string) => {
    const current = settings.appSettings.value;
    if (!current) return;
    const normalized = String(path ?? "").trim();
    const nextValue = normalized.length > 0 ? normalized : undefined;
    if (current.vmafMeasureReferencePath === nextValue) return;
    const next: AppSettings = {
      ...current,
      vmafMeasureReferencePath: nextValue,
    };
    settings.appSettings.value = next;
  };

  const panelProps = proxyRefs({
    presets: computed(() => presets.presets),
    presetSortMode: computed(() => presets.presetSortMode),
    presetSortDirection: computed(() => presets.presetSortDirection),
    presetViewMode: computed(() => presets.presetViewMode),
    presetSelectionBarPinned: computed(() => presets.presetSelectionBarPinned),
    presetCardFooter,
    vmafMeasureReferencePath,
    setVmafMeasureReferencePath,
    ensureAppSettingsLoaded: settings.ensureAppSettingsLoaded,
    setPresetSelectionBarPinned: presets.setPresetSelectionBarPinned,
    setPresetSortMode: (mode: PresetSortMode) => {
      presets.presetSortMode = mode;
    },
    setPresetSortDirection: (direction: PresetSortDirection) => {
      presets.presetSortDirection = direction;
    },
    setPresetViewMode: (mode: PresetViewMode) => {
      presets.presetViewMode = mode;
    },
    dialogManager: dialogs.dialogManager,
    presetsModule: presetsDomain,
  });

  return { panelProps };
}
