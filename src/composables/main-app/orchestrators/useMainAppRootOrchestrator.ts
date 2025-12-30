import { computed, proxyRefs } from "vue";
import type { MainAppContext } from "@/MainApp.setup";
import { deriveProgressTransitionMs } from "@/lib/progressTransition";
import { useLocalePersistence } from "@/composables/main-app/useLocalePersistence";
import { useQueueBlankClickClearSelection } from "@/composables/main-app/useQueueBlankClickClearSelection";

export function useMainAppRootOrchestrator(context: MainAppContext) {
  const shell = proxyRefs(context.shell);
  const queue = proxyRefs(context.queue);
  const settings = proxyRefs(context.settings);
  const updater = proxyRefs(context.settings.updater);
  const dnd = proxyRefs(context.queue.dnd);

  useQueueBlankClickClearSelection({
    activeTab: context.shell.activeTab,
    hasSelection: context.queue.hasSelection,
    clearSelection: context.queue.clearSelection,
  });

  const { handleLocaleChange } = useLocalePersistence({
    appSettings: context.settings.appSettings,
    handleUpdateAppSettings: context.settings.handleUpdateAppSettings,
  });

  const titleBarProps = proxyRefs({
    currentTitle: computed(() => shell.currentTitle),
    currentVersion: computed(() => updater.currentVersion),
    progressPercent: computed(() => settings.headerProgressPercent),
    progressVisible: computed(() => settings.headerProgressVisible),
    progressFading: computed(() => settings.headerProgressFading),
    progressTransitionMs: computed(() => deriveProgressTransitionMs(settings.progressUpdateIntervalMs)),
  });

  const titleBarListeners = {
    minimize: shell.minimizeWindow,
    toggleMaximize: shell.toggleMaximizeWindow,
    close: shell.closeWindow,
    localeChange: handleLocaleChange,
  } as const;

  const sidebarProps = proxyRefs({
    activeTab: computed(() => shell.activeTab),
    jobs: computed(() => queue.jobs),
    appUpdateAvailable: computed(() => updater.updateAvailable),
  });

  const sidebarListeners = {
    "update:activeTab": (tab: "queue" | "presets" | "media" | "monitor" | "settings") => {
      shell.activeTab = tab;
    },
    addJobFiles: () => context.presetsModule.addManualJob("files"),
    addJobFolder: () => context.presetsModule.addManualJob("folder"),
    batchCompress: context.dialogs.batchCompress.startBatchCompress,
  } as const;

  const globalAlertsProps = proxyRefs({
    queueError: computed(() => queue.queueError),
    mediaInspectError: computed(() => context.media.mediaInspectError.value),
    settingsSaveError: computed(() => settings.settingsSaveError),
  });

  const globalAlertsListeners = {
    clearQueueError: () => {
      queue.queueError = null;
    },
    clearMediaInspectError: () => {
      context.media.mediaInspectError.value = null;
    },
    clearSettingsSaveError: () => {
      settings.settingsSaveError = null;
    },
  } as const;

  const openToolsSettings = () => {
    shell.activeTab = "settings";
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
