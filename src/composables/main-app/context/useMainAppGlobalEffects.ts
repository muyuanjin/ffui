import { computed, watch } from "vue";
import type { DialogsDomain, PresetsDomain, QueueDomain, SettingsDomain } from "@/MainApp.types";
import { useBodyPointerEventsFailsafe } from "@/composables/main-app/useBodyPointerEventsFailsafe";
import type { MainAppSharedState } from "./useMainAppSharedState";

export interface UseMainAppGlobalEffectsOptions {
  state: MainAppSharedState;
  dialogs: DialogsDomain;
  presets: PresetsDomain;
  queue: QueueDomain;
  settings: SettingsDomain;
}

export function useMainAppGlobalEffects(options: UseMainAppGlobalEffectsOptions) {
  const { state, dialogs, presets, queue, settings } = options;

  watch(
    () => settings.appSettings.value?.locale,
    (nextLocale) => {
      if (typeof nextLocale !== "string") return;
      const normalized = nextLocale.trim();
      if (normalized !== "en" && normalized !== "zh-CN") return;
      if (state.locale.value === normalized) return;
      state.locale.value = normalized;
    },
    { flush: "post", immediate: true },
  );

  const hasBlockingOverlay = computed(() => {
    const dm = dialogs.dialogManager;
    return (
      dm.wizardOpen.value ||
      dm.parameterPanelOpen.value ||
      dm.batchCompressOpen.value ||
      dm.jobDetailOpen.value ||
      dm.batchDetailOpen.value ||
      dm.previewOpen.value ||
      dm.jobCompareOpen.value ||
      dm.exitConfirmOpen.value ||
      dm.deletePresetDialogOpen.value ||
      dm.smartPresetImportOpen.value ||
      dm.importCommandsOpen.value ||
      presets.presetPendingDelete.value != null ||
      presets.presetsPendingBatchDelete.value.length > 0 ||
      queue.queueDeleteConfirmOpen.value ||
      queue.dnd.waitingJobContextMenuVisible.value ||
      queue.queueContextMenu.queueContextMenuVisible.value
    );
  });

  useBodyPointerEventsFailsafe({ hasBlockingOverlay });
}
