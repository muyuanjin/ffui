import { computed, proxyRefs } from "vue";
import { usePresetsDomain, useSettingsDomain } from "@/MainApp.setup";

export function useMainSettingsTabOrchestrator() {
  const presets = usePresetsDomain();
  const settings = useSettingsDomain();
  const updater = settings.updater;

  const appUpdate = computed(() => {
    return {
      configured: updater.updaterConfigured.value,
      autoCheckDefault: updater.autoCheckDefault.value,
      available: updater.updateAvailable.value,
      checking: updater.isCheckingForUpdate.value,
      installing: updater.isInstallingUpdate.value,
      availableVersion: updater.availableVersion.value,
      availableBody: updater.availableBody.value,
      currentVersion: updater.currentVersion.value,
      lastCheckedAtMs: updater.lastCheckedAtMs.value,
      downloadedBytes: updater.downloadedBytes.value,
      totalBytes: updater.totalBytes.value,
      error: updater.updateCheckError.value,
    };
  });

  const panelProps = proxyRefs({
    appSettings: computed(() => settings.appSettings.value),
    toolStatuses: computed(() => settings.toolStatuses.value),
    toolStatusesFresh: computed(() => settings.toolStatusesFresh.value),
    refreshToolStatuses: computed(() => settings.refreshToolStatuses),
    isSavingSettings: computed(() => settings.isSavingSettings.value),
    settingsSaveError: computed(() => settings.settingsSaveError.value),
    reloadPresets: computed(() => presets.reloadPresets),
    appUpdate: computed(() => appUpdate.value),
    checkForAppUpdate: computed(() => updater.checkForAppUpdate),
    installAppUpdate: computed(() => updater.downloadAndInstallUpdate),
    fetchToolCandidates: computed(() => settings.fetchToolCandidates),
  });

  const panelListeners = {
    "update:appSettings": settings.handleUpdateAppSettings,
    downloadTool: settings.downloadToolNow,
  } as const;

  return { panelProps, panelListeners };
}
