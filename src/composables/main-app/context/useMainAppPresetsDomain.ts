import { computed, ref, watch } from "vue";
import type { AppSettings, FFmpegPreset } from "@/types";
import type { DialogsDomain, PresetsDomain, SettingsDomain, ShellDomain } from "@/MainApp.types";
import { hasTauri } from "@/lib/backend";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { usePresetPanelModePersistence } from "@/composables/main-app/usePresetPanelModePersistence";
import type { MainAppSharedState } from "./useMainAppSharedState";

export interface UseMainAppPresetsDomainOptions {
  state: MainAppSharedState;
  shell: ShellDomain;
  dialogs: Pick<DialogsDomain, "dialogManager">;
  settings: SettingsDomain;
}

const createTemporaryAppSettings = (): AppSettings =>
  ({
    tools: {},
    batchCompressDefaults: {},
    previewCapturePercent: 50,
  }) as AppSettings;

export function useMainAppPresetsDomain(options: UseMainAppPresetsDomainOptions): PresetsDomain {
  const { state, shell, dialogs, settings } = options;
  const presetsModule = useMainAppPresets({
    t: state.t,
    locale: state.locale,
    presets: state.presets,
    presetsLoadedFromBackend: state.presetsLoadedFromBackend,
    manualJobPresetId: state.manualJobPresetId,
    dialogManager: dialogs.dialogManager,
    shell,
  });

  usePresetPanelModePersistence({
    presetSortMode: state.presetSortMode,
    presetSortDirection: state.presetSortDirection,
    presetViewMode: state.presetViewMode,
    appSettings: settings.appSettings,
    ensureAppSettingsLoaded: settings.ensureAppSettingsLoaded,
    persistNow: settings.persistNow,
  });

  const autoOnboardingTriggered = ref(false);
  const autoOnboardingReplaceExisting = ref(false);

  const markOnboardingCompleted = async () => {
    if (!hasTauri()) return;
    const current = settings.appSettings.value;
    if (!current || current.onboardingCompleted) return;

    console.info("[onboarding] marking onboardingCompleted=true");
    const next: AppSettings = { ...current, onboardingCompleted: true };
    settings.appSettings.value = next;
    await settings.persistNow(next);
  };

  const handleImportSmartPackConfirmedWithOnboarding = async (presetsToImport: FFmpegPreset[]) => {
    const shouldReplaceExisting =
      autoOnboardingReplaceExisting.value || !settings.appSettings.value?.onboardingCompleted;
    autoOnboardingReplaceExisting.value = false;
    await presetsModule.handleImportSmartPackConfirmed(presetsToImport, {
      replaceExisting: shouldReplaceExisting,
    });
    await markOnboardingCompleted();
  };

  watch(
    () => dialogs.dialogManager.smartPresetImportOpen.value,
    (open) => {
      if (open) return;
      autoOnboardingReplaceExisting.value = false;
    },
  );

  watch(
    () => settings.appSettings.value,
    (value) => {
      if (!hasTauri()) return;
      if (!value) return;

      if (!value.onboardingCompleted && !autoOnboardingTriggered.value) {
        autoOnboardingTriggered.value = true;
        autoOnboardingReplaceExisting.value = true;
        console.info("[onboarding] auto-opening smart preset onboarding");
        dialogs.dialogManager.openSmartPresetImport();
        void markOnboardingCompleted();
      }
    },
    { flush: "post" },
  );

  const presetSelectionBarPinned = computed(() => settings.appSettings.value?.presetSelectionBarPinned ?? false);
  const setPresetSelectionBarPinned = (pinned: boolean) => {
    const current = settings.appSettings.value;
    if (current?.presetSelectionBarPinned === pinned) return;

    settings.appSettings.value = {
      ...(current ?? createTemporaryAppSettings()),
      presetSelectionBarPinned: pinned,
    };
  };

  return {
    ...presetsModule,
    presets: state.presets,
    presetsLoadedFromBackend: state.presetsLoadedFromBackend,
    manualJobPresetId: state.manualJobPresetId,
    presetSortMode: state.presetSortMode,
    presetSortDirection: state.presetSortDirection,
    presetViewMode: state.presetViewMode,
    presetSelectionBarPinned,
    setPresetSelectionBarPinned,
    handleImportSmartPackConfirmedWithOnboarding,
  };
}
