import { computed } from "vue";
import type { AppSettings } from "@/types";
import type { SettingsDomain } from "@/MainApp.types";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import { useMainAppUpdater } from "@/composables/main-app/useMainAppUpdater";
import { useUiAppearanceSync } from "@/composables/main-app/useUiAppearanceSync";
import type { MainAppSharedState } from "./useMainAppSharedState";
import type { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";

export interface UseMainAppSettingsDomainOptions {
  state: MainAppSharedState;
  batchCompress: ReturnType<typeof useMainAppBatchCompress>;
}

export function useMainAppSettingsDomain(options: UseMainAppSettingsDomainOptions): SettingsDomain {
  const { state, batchCompress } = options;
  const settings = useMainAppSettings({
    jobs: state.jobs,
    queueStructureRevision: state.lastQueueSnapshotRevision,
    manualJobPresetId: state.manualJobPresetId,
    smartConfig: batchCompress.smartConfig,
    startupIdleReady: state.startupIdleReady,
  });

  useUiAppearanceSync(settings.appSettings);

  const updater = useMainAppUpdater({
    appSettings: settings.appSettings,
    scheduleSaveSettings: settings.scheduleSaveSettings,
    persistNow: settings.persistNow,
    startupIdleReady: state.startupIdleReady,
  });

  const ffmpegResolvedPath = computed(() => {
    const status = settings.toolStatuses.value.find((s) => s.kind === "ffmpeg");
    if (status?.resolvedPath) return status.resolvedPath;
    return settings.appSettings.value?.tools?.ffmpegPath ?? null;
  });

  const handleUpdateAppSettings = (next: AppSettings) => {
    settings.appSettings.value = next;
  };

  return {
    ...settings,
    updater,
    handleUpdateAppSettings,
    ffmpegResolvedPath,
  };
}
