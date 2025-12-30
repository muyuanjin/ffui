<script setup lang="ts">
import { computed } from "vue";
import { SettingsPanel } from "@/components/main/lazyTabs";
import { usePresetsDomain, useSettingsDomain } from "@/MainApp.setup";

const presets = usePresetsDomain();
const settings = useSettingsDomain();
const updater = settings.updater;
const reloadPresets = presets.reloadPresets;
const updateAppSettings = settings.handleUpdateAppSettings;

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
