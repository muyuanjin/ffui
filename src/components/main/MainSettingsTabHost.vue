<script setup lang="ts">
import { computed } from "vue";
import type { AppSettings } from "@/types";
import type { UseMainAppSettingsReturn } from "@/composables/main-app/useMainAppSettings";
import type { UseMainAppUpdaterReturn } from "@/composables/main-app/useMainAppUpdater";
import { SettingsPanel } from "@/components/main/lazyTabs";

const props = defineProps<{
  settings: UseMainAppSettingsReturn;
  updater: UseMainAppUpdaterReturn;
  reloadPresets?: () => Promise<void>;
  updateAppSettings: (next: AppSettings) => void;
}>();

const settings = props.settings;
const updater = props.updater;

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
</script>

<template>
  <SettingsPanel
    :app-settings="settings.appSettings.value"
    :tool-statuses="settings.toolStatuses.value"
    :tool-statuses-fresh="settings.toolStatusesFresh.value"
    :refresh-tool-statuses="settings.refreshToolStatuses"
    :is-saving-settings="settings.isSavingSettings.value"
    :settings-save-error="settings.settingsSaveError.value"
    :reload-presets="reloadPresets"
    :app-update="appUpdate"
    :check-for-app-update="updater.checkForAppUpdate"
    :install-app-update="updater.downloadAndInstallUpdate"
    :fetch-tool-candidates="settings.fetchToolCandidates"
    @update:app-settings="updateAppSettings"
    @download-tool="settings.downloadToolNow"
  />
</template>
