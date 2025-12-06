import { ref, watch, type Ref } from "vue";
import type { AppSettings, ExternalToolKind, ExternalToolStatus, SmartScanConfig } from "@/types";
import {
  hasTauri,
  loadAppSettings,
  saveAppSettings,
  fetchExternalToolStatuses,
} from "@/lib/backend";

// ----- Composable -----

export interface UseAppSettingsOptions {
  /** Smart config ref (to restore from settings). */
  smartConfig?: Ref<SmartScanConfig>;
  /** Manual job preset ID ref (to restore from settings). */
  manualJobPresetId?: Ref<string | null>;
  /** Optional i18n translation function for user-facing messages. */
  t?: (key: string) => string;
}

export interface UseAppSettingsReturn {
  // ----- State -----
  /** App settings. */
  appSettings: Ref<AppSettings | null>;
  /** Whether settings are being saved. */
  isSavingSettings: Ref<boolean>;
  /** Settings save error message. */
  settingsSaveError: Ref<string | null>;
  /** External tool statuses. */
  toolStatuses: Ref<ExternalToolStatus[]>;

  // ----- Methods -----
  /** Ensure app settings are loaded. */
  ensureAppSettingsLoaded: () => Promise<void>;
  /** Schedule settings save (with debouncing). */
  scheduleSaveSettings: () => void;
  /** Refresh external tool statuses. */
  refreshToolStatuses: () => Promise<void>;
  /** Get display name for a tool kind. */
  getToolDisplayName: (kind: ExternalToolKind) => string;
  /** Get custom path for a tool. */
  getToolCustomPath: (kind: ExternalToolKind) => string;
  /** Set custom path for a tool. */
  setToolCustomPath: (kind: ExternalToolKind, value: string | number) => void;
  /** Clean up timers (call in onUnmounted). */
  cleanup: () => void;
}

/**
 * Composable for app settings management.
 */
export function useAppSettings(options: UseAppSettingsOptions = {}): UseAppSettingsReturn {
  const { smartConfig, manualJobPresetId, t } = options;

  // ----- State -----
  const appSettings = ref<AppSettings | null>(null);
  const isSavingSettings = ref(false);
  const settingsSaveError = ref<string | null>(null);
  const toolStatuses = ref<ExternalToolStatus[]>([]);
  let settingsSaveTimer: number | undefined;
  let lastSavedSettingsSnapshot: string | null = null;

  // ----- Auto-save Watch -----
  watch(
    appSettings,
    () => {
      if (!appSettings.value) return;
      // Persist changes to settings automatically with debouncing.
      scheduleSaveSettings();
    },
    { deep: true },
  );

  // ----- Methods -----
  const ensureAppSettingsLoaded = async () => {
    if (!hasTauri()) return;
    if (appSettings.value) return;
    try {
      const settings = await loadAppSettings();
      appSettings.value = settings;
      lastSavedSettingsSnapshot = JSON.stringify(settings);
      if (settings?.smartScanDefaults && smartConfig) {
        smartConfig.value = { ...settings.smartScanDefaults };
      }
      // Restore the user's preferred default queue preset when available.
      if (settings?.defaultQueuePresetId && manualJobPresetId) {
        manualJobPresetId.value = settings.defaultQueuePresetId;
      }
    } catch (error) {
      console.error("Failed to load app settings", error);
    }
  };

  const scheduleSaveSettings = () => {
    if (!hasTauri() || !appSettings.value) return;
    settingsSaveError.value = null;
    if (settingsSaveTimer !== undefined) {
      window.clearTimeout(settingsSaveTimer);
    }
    // Use a minimal async delay so tests can reliably observe saves without
    // needing to advance long timers, while still debouncing rapid changes.
    settingsSaveTimer = window.setTimeout(async () => {
      if (!hasTauri() || !appSettings.value) return;
      const current = appSettings.value;
      const serialized = JSON.stringify(current);
      if (serialized === lastSavedSettingsSnapshot) {
        return;
      }
      isSavingSettings.value = true;
      try {
        const saved = await saveAppSettings(current);
        appSettings.value = saved;
        lastSavedSettingsSnapshot = JSON.stringify(saved);
        await refreshToolStatuses();
      } catch (error) {
        console.error("Failed to save settings", error);
        settingsSaveError.value =
          (t?.("app.settings.saveErrorGeneric") as string) ??
          "Failed to save settings. Please try again later.";
      } finally {
        isSavingSettings.value = false;
      }
      }, 0);
  };

  const refreshToolStatuses = async () => {
    if (!hasTauri()) return;
    try {
      toolStatuses.value = await fetchExternalToolStatuses();
    } catch (error) {
      console.error("Failed to load external tool statuses", error);
    }
  };

  const getToolDisplayName = (kind: ExternalToolKind): string => {
    if (kind === "ffmpeg") return "FFmpeg";
    if (kind === "ffprobe") return "ffprobe";
    if (kind === "avifenc") return "avifenc";
    return kind;
  };

  const getToolCustomPath = (kind: ExternalToolKind): string => {
    if (!appSettings.value) return "";
    const tools = appSettings.value.tools;
    if (kind === "ffmpeg") return tools.ffmpegPath ?? "";
    if (kind === "ffprobe") return tools.ffprobePath ?? "";
    if (kind === "avifenc") return tools.avifencPath ?? "";
    return "";
  };

  const setToolCustomPath = (kind: ExternalToolKind, value: string | number) => {
    if (!appSettings.value) return;
    const tools = appSettings.value.tools;
    const normalized = String(value ?? "").trim();
    if (kind === "ffmpeg") {
      tools.ffmpegPath = normalized || undefined;
    } else if (kind === "ffprobe") {
      tools.ffprobePath = normalized || undefined;
    } else if (kind === "avifenc") {
      tools.avifencPath = normalized || undefined;
    }
  };

  const cleanup = () => {
    if (settingsSaveTimer !== undefined) {
      window.clearTimeout(settingsSaveTimer);
      settingsSaveTimer = undefined;
    }
  };

  return {
    // State
    appSettings,
    isSavingSettings,
    settingsSaveError,
    toolStatuses,

    // Methods
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
    refreshToolStatuses,
    getToolDisplayName,
    getToolCustomPath,
    setToolCustomPath,
    cleanup,
  };
}

export default useAppSettings;
