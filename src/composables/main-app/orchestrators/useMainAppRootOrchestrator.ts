import { computed, proxyRefs } from "vue";
import {
  useDialogsDomain,
  useMediaDomain,
  usePresetsDomain,
  useQueueDomain,
  useSettingsDomain,
  useShellDomain,
} from "@/MainApp.setup";
import { deriveProgressTransitionMs } from "@/lib/progressTransition";
import { useLocalePersistence } from "@/composables/main-app/useLocalePersistence";
import { useQueueBlankClickClearSelection } from "@/composables/main-app/useQueueBlankClickClearSelection";

export function useMainAppRootOrchestrator() {
  const shell = useShellDomain();
  const queue = useQueueDomain();
  const presets = usePresetsDomain();
  const dialogs = useDialogsDomain();
  const media = useMediaDomain();
  const settings = useSettingsDomain();
  const updater = settings.updater;
  const dnd = queue.dnd;

  useQueueBlankClickClearSelection({
    activeTab: shell.activeTab,
    hasSelection: queue.hasSelection,
    clearSelection: queue.clearSelection,
  });

  const { handleLocaleChange } = useLocalePersistence({
    appSettings: settings.appSettings,
    handleUpdateAppSettings: settings.handleUpdateAppSettings,
  });

  const titleBarProps = proxyRefs({
    currentTitle: computed(() => shell.currentTitle.value),
    currentVersion: computed(() => updater.currentVersion.value),
    progressPercent: computed(() => settings.headerProgressPercent.value),
    progressVisible: computed(() => settings.headerProgressVisible.value),
    progressFading: computed(() => settings.headerProgressFading.value),
    progressTransitionMs: computed(() => deriveProgressTransitionMs(settings.progressUpdateIntervalMs.value)),
  });

  const titleBarListeners = {
    minimize: shell.minimizeWindow,
    toggleMaximize: shell.toggleMaximizeWindow,
    close: shell.closeWindow,
    localeChange: handleLocaleChange,
  } as const;

  const sidebarProps = proxyRefs({
    activeTab: computed(() => shell.activeTab.value),
    jobs: computed(() => queue.jobs.value),
    appUpdateAvailable: computed(() => updater.updateAvailable.value),
  });

  const sidebarListeners = {
    "update:activeTab": (tab: "queue" | "presets" | "media" | "monitor" | "settings") => {
      shell.activeTab.value = tab;
    },
    addJobFiles: () => presets.addManualJob("files"),
    addJobFolder: () => presets.addManualJob("folder"),
    batchCompress: dialogs.batchCompress.startBatchCompress,
  } as const;

  const globalAlertsProps = proxyRefs({
    queueError: computed(() => queue.queueError.value),
    mediaInspectError: computed(() => media.mediaInspectError.value),
    settingsSaveError: computed(() => settings.settingsSaveError.value),
  });

  const globalAlertsListeners = {
    clearQueueError: () => {
      queue.queueError.value = null;
    },
    clearMediaInspectError: () => {
      media.mediaInspectError.value = null;
    },
    clearSettingsSaveError: () => {
      settings.settingsSaveError.value = null;
    },
  } as const;

  const openToolsSettings = () => {
    shell.activeTab.value = "settings";
  };

  return {
    shell,
    dnd,
    titleBarProps,
    titleBarListeners,
    sidebarProps,
    sidebarListeners,
    globalAlertsProps,
    globalAlertsListeners,
    openToolsSettings,
  };
}
