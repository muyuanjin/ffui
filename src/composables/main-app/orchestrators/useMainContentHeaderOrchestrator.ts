import { computed, proxyRefs } from "vue";
import { useDialogsDomain, usePresetsDomain, useQueueDomain, useShellDomain, useSettingsDomain } from "@/MainApp.setup";
import type { OutputPolicy, QueueViewMode, QueuePresetSelection } from "@/types";
import { DEFAULT_QUEUE_PRESET_SELECTION } from "@/lib/manualPresetRouting";

export function useMainContentHeaderOrchestrator() {
  const dialogs = useDialogsDomain();
  const shell = proxyRefs(useShellDomain());
  const queue = proxyRefs(useQueueDomain());
  const presets = proxyRefs(usePresetsDomain());
  const settings = proxyRefs(useSettingsDomain());

  const headerProps = proxyRefs({
    activeTab: computed(() => shell.activeTab),
    currentTitle: computed(() => shell.currentTitle),
    currentSubtitle: computed(() => shell.currentSubtitle),
    jobsLength: computed(() => queue.jobs.length),
    completedCount: computed(() => queue.completedCount),
    manualJobPresetId: computed(() => presets.manualJobPresetId),
    queuePresetSelection: computed(
      () => settings.getAppSetting("queuePresetSelection") ?? DEFAULT_QUEUE_PRESET_SELECTION,
    ),
    presets: computed(() => presets.presets),
    queueViewModeModel: computed(() => queue.queueViewModeModel),
    presetSortMode: computed(() => presets.presetSortMode),
    presetSortDirection: computed(() => presets.presetSortDirection),
    queueOutputPolicy: computed(() => queue.queueOutputPolicy),
    outputSettingsReady: computed(() => settings.appSettings !== null),
    carouselAutoRotationSpeed: computed(() => queue.carouselAutoRotationSpeed),
  });

  const headerListeners = {
    "update:queuePresetSelection": (value: QueuePresetSelection) => {
      void settings.updateAppSettings({ queuePresetSelection: value });
    },
    "update:manualJobPresetId": (value: string | null) => {
      presets.manualJobPresetId = value;
      void settings.updateAppSettings({ defaultQueuePresetId: value ?? undefined });
    },
    "update:queueViewModeModel": (value: QueueViewMode) => {
      queue.queueViewModeModel = value;
    },
    "update:queueOutputPolicy": (value: OutputPolicy) => {
      queue.setQueueOutputPolicy(value);
    },
    "update:carouselAutoRotationSpeed": (value: number) => {
      queue.setCarouselAutoRotationSpeed(value);
    },
    openPresetWizard: () => dialogs.dialogManager.openWizard(),
  } as const;

  return {
    headerProps,
    headerListeners,
  };
}
