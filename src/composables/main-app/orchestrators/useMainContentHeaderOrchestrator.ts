import { computed, proxyRefs } from "vue";
import { useDialogsDomain, usePresetsDomain, useQueueDomain, useShellDomain } from "@/MainApp.setup";
import type { OutputPolicy, QueueViewMode } from "@/types";

export function useMainContentHeaderOrchestrator() {
  const dialogs = useDialogsDomain();
  const shell = proxyRefs(useShellDomain());
  const queue = proxyRefs(useQueueDomain());
  const presets = proxyRefs(usePresetsDomain());

  const headerProps = proxyRefs({
    activeTab: computed(() => shell.activeTab),
    currentTitle: computed(() => shell.currentTitle),
    currentSubtitle: computed(() => shell.currentSubtitle),
    jobsLength: computed(() => queue.jobs.length),
    completedCount: computed(() => queue.completedCount),
    manualJobPresetId: computed(() => presets.manualJobPresetId),
    presets: computed(() => presets.presets),
    queueViewModeModel: computed(() => queue.queueViewModeModel),
    presetSortMode: computed(() => presets.presetSortMode),
    presetSortDirection: computed(() => presets.presetSortDirection),
    queueOutputPolicy: computed(() => queue.queueOutputPolicy),
    carouselAutoRotationSpeed: computed(() => queue.carouselAutoRotationSpeed),
  });

  const headerListeners = {
    "update:manualJobPresetId": (value: string | null) => {
      presets.manualJobPresetId = value;
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
