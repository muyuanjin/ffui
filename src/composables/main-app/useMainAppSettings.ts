import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AppSettings,
  ExternalToolCandidate,
  ExternalToolKind,
  SmartScanConfig,
  TranscodeJob,
} from "@/types";
import { hasTauri, saveAppSettings } from "@/lib/backend";
import { useAppSettings, useJobProgress } from "@/composables";

export interface UseMainAppSettingsOptions {
  jobs: Ref<TranscodeJob[]>;
  manualJobPresetId: Ref<string | null>;
  smartConfig: Ref<SmartScanConfig>;
  /** Optional startup idle gate so initial calls can be deferred until after first paint. */
  startupIdleReady?: Ref<boolean>;
}

export interface UseMainAppSettingsReturn {
  appSettings: Ref<AppSettings | null>;
  isSavingSettings: Ref<boolean>;
  settingsSaveError: Ref<string | null>;
  toolStatuses: ReturnType<typeof useAppSettings>["toolStatuses"];
  ensureAppSettingsLoaded: () => Promise<void>;
  scheduleSaveSettings: () => void;
  refreshToolStatuses: () => Promise<void>;
  downloadToolNow: ReturnType<typeof useAppSettings>["downloadToolNow"];
  fetchToolCandidates: (
    kind: ExternalToolKind,
  ) => Promise<ExternalToolCandidate[]>;
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
  const { jobs, manualJobPresetId, smartConfig, startupIdleReady } = options;

  const { t } = useI18n();

  const {
    appSettings,
    isSavingSettings,
    settingsSaveError,
    toolStatuses,
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
    refreshToolStatuses,
    downloadToolNow,
    fetchToolCandidates,
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
        await saveAppSettings(nextSettings);
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
    const runStartupSettingsLoad = async () => {
      await ensureAppSettingsLoaded();
      await refreshToolStatuses();
    };

    // When no idle gate is provided, preserve the previous behaviour and run
    // startup calls immediately on mount.
    if (!startupIdleReady) {
      await runStartupSettingsLoad();
      return;
    }

    // If the gate is already open, run immediately.
    if (startupIdleReady.value) {
      await runStartupSettingsLoad();
      return;
    }

    // Otherwise wait until the idle gate opens, then run the startup calls
    // once. This keeps first paint responsive while still ensuring settings
    // and tool statuses are loaded early in the session.
    const stop = watch(
      startupIdleReady,
      (ready) => {
        if (!ready) return;
        stop();
        void runStartupSettingsLoad();
      },
      { flush: "post" },
    );
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
    downloadToolNow,
    fetchToolCandidates,
    progressUpdateIntervalMs,
    globalTaskbarProgressPercent,
    headerProgressPercent,
    headerProgressVisible,
    headerProgressFading,
  };
}

export default useMainAppSettings;
