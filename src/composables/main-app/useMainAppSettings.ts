import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, SmartScanConfig, TranscodeJob } from "@/types";
import { hasTauri, saveAppSettings } from "@/lib/backend";
import { useAppSettings, useJobProgress } from "@/composables";

export interface UseMainAppSettingsOptions {
  jobs: Ref<TranscodeJob[]>;
  manualJobPresetId: Ref<string | null>;
  smartConfig: Ref<SmartScanConfig>;
}

export interface UseMainAppSettingsReturn {
  appSettings: Ref<AppSettings | null>;
  isSavingSettings: Ref<boolean>;
  settingsSaveError: Ref<string | null>;
  toolStatuses: ReturnType<typeof useAppSettings>["toolStatuses"];
  ensureAppSettingsLoaded: () => Promise<void>;
  scheduleSaveSettings: () => void;
  refreshToolStatuses: () => Promise<void>;
  progressUpdateIntervalMs: ReturnType<typeof useJobProgress>["progressUpdateIntervalMs"];
  globalTaskbarProgressPercent: ReturnType<typeof useJobProgress>["globalTaskbarProgressPercent"];
  headerProgressPercent: ReturnType<typeof useJobProgress>["headerProgressPercent"];
  headerProgressVisible: ReturnType<typeof useJobProgress>["headerProgressVisible"];
  headerProgressFading: ReturnType<typeof useJobProgress>["headerProgressFading"];
}

/**
 * App settings + job progress wiring for MainApp.
 *
 * - Delegates persistence to useAppSettings.
 * - Delegates aggregate progress/header animation to useJobProgress.
 * - Keeps AppSettings.defaultQueuePresetId in sync with manualJobPresetId.
 */
export function useMainAppSettings(
  options: UseMainAppSettingsOptions,
): UseMainAppSettingsReturn {
  const { jobs, manualJobPresetId, smartConfig } = options;

  const { t } = useI18n();

  const {
    appSettings,
    isSavingSettings,
    settingsSaveError,
    toolStatuses,
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
    refreshToolStatuses,
    cleanup: cleanupAppSettings,
  } = useAppSettings({
    smartConfig,
    manualJobPresetId,
    t,
  });

  const {
    progressUpdateIntervalMs,
    globalTaskbarProgressPercent,
    headerProgressPercent,
    headerProgressVisible,
    headerProgressFading,
    cleanup: cleanupJobProgress,
  } = useJobProgress({ jobs, appSettings });

  // Keep AppSettings.defaultQueuePresetId in sync when the user changes the
  // queue header preset selector. This ensures the next launch restores the
  // same default preset.
  watch(
    manualJobPresetId,
    async (nextId) => {
      if (!appSettings.value || !hasTauri()) return;
      if (appSettings.value.defaultQueuePresetId === nextId) return;

      const nextSettings: AppSettings = {
        ...appSettings.value,
        defaultQueuePresetId: nextId || undefined,
      };
      appSettings.value = nextSettings;

      // Persist immediately so tests and real users both see the new default
      // without waiting for the debounced saver, while still keeping the shared
      // app settings composable as the single source of truth.
      try {
        const saved = await saveAppSettings(nextSettings);
        appSettings.value = saved;
      } catch (error) {
        console.error("Failed to save default queue preset to AppSettings", error);
      }

      // Let the shared app settings composable handle any follow-up status
      // refresh; its internal debounce will see the snapshot as already saved.
      scheduleSaveSettings();
    },
    { flush: "post" },
  );

  // Best-effort load of app settings and external tools on mount.
  onMounted(async () => {
    await ensureAppSettingsLoaded();
    await refreshToolStatuses();
  });

  onUnmounted(() => {
    cleanupJobProgress();
    cleanupAppSettings();
  });

  // Expose aggregated taskbar progress for tests.
  void globalTaskbarProgressPercent;

  return {
    appSettings,
    isSavingSettings,
    settingsSaveError,
    toolStatuses,
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
    refreshToolStatuses,
    progressUpdateIntervalMs,
    globalTaskbarProgressPercent,
    headerProgressPercent,
    headerProgressVisible,
    headerProgressFading,
  };
}

export default useMainAppSettings;
