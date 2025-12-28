import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import type {
  AppSettings,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  BatchCompressConfig,
  Translate,
} from "@/types";
import {
  hasTauri,
  loadAppSettings,
  saveAppSettings,
  fetchExternalToolStatusesCached,
  refreshExternalToolStatusesAsync,
  fetchExternalToolCandidates,
  downloadExternalToolNow,
} from "@/lib/backend";
import { startupNowMs, updateStartupMetrics } from "@/lib/startupMetrics";
import { perfLog } from "@/lib/perfLog";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { stringifyJsonAsync } from "@/lib/asyncJson";
import { buildWebFallbackAppSettings } from "./appSettingsWebFallback";
import {
  externalToolCustomPath,
  externalToolDisplayName,
  installExternalToolAutoUpdateWatcher,
  setExternalToolCustomPath,
} from "./useAppSettingsExternalTools";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

let loggedAppSettingsLoad = false;
let loggedToolStatusLoad = false;

// ----- Composable -----

const normalizeLoadedAppSettings = (settings: AppSettings): AppSettings => {
  const next: AppSettings = { ...settings };

  // Normalize the locale string so we don't persist empty/whitespace values.
  if (typeof next.locale === "string") {
    const normalized = next.locale.trim();
    next.locale = normalized.length > 0 ? normalized : undefined;
  }

  // Font mode exclusivity (new UI): keep exactly one source active.
  if (typeof next.uiFontFilePath === "string" && next.uiFontFilePath.trim().length > 0) {
    next.uiFontDownloadId = undefined;
    next.uiFontFamily = "system";
    if (!next.uiFontName || !next.uiFontName.trim()) {
      next.uiFontName = "FFUI Imported";
    }
  } else if (typeof next.uiFontDownloadId === "string" && next.uiFontDownloadId.trim().length > 0) {
    next.uiFontFilePath = undefined;
    next.uiFontFamily = "system";
  }

  // Legacy generic families (sans/mono) are no longer surfaced in Settings.
  const family = next.uiFontFamily;
  if ((family === "sans" || family === "mono") && !next.uiFontName && !next.uiFontDownloadId && !next.uiFontFilePath) {
    next.uiFontFamily = "system";
  }

  // Output policy defaults (queue + Batch Compress).
  if (!next.queueOutputPolicy) {
    next.queueOutputPolicy = { ...DEFAULT_OUTPUT_POLICY };
  }
  if (next.batchCompressDefaults && !next.batchCompressDefaults.outputPolicy) {
    next.batchCompressDefaults = {
      ...next.batchCompressDefaults,
      outputPolicy: { ...DEFAULT_OUTPUT_POLICY },
    };
  }

  return next;
};

export interface UseAppSettingsOptions {
  /** Smart config ref (to restore from settings). */
  smartConfig?: Ref<BatchCompressConfig>;
  /** Manual job preset ID ref (to restore from settings). */
  manualJobPresetId?: Ref<string | null>;
  /** Optional i18n translation function for user-facing messages. */
  t?: Translate;
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
  /** Whether tool statuses have been refreshed at least once this session. */
  toolStatusesFresh: Ref<boolean>;

  // ----- Methods -----
  /** Ensure app settings are loaded. */
  ensureAppSettingsLoaded: () => Promise<void>;
  /** Schedule settings save (with debouncing). */
  scheduleSaveSettings: () => void;
  /**
   * Persist a settings snapshot immediately (bypasses debounce) and updates the
   * internal "last saved" snapshot so follow-up debounced saves don't double-write.
   */
  persistNow: (nextSettings?: AppSettings) => Promise<void>;
  /**
   * Mark a snapshot as saved without performing I/O. Use this when settings
   * were persisted outside of useAppSettings and you need to keep the internal
   * snapshot consistent.
   */
  markSaved: (serializedOrSettings: string | AppSettings) => void;
  /** Refresh external tool statuses. */
  refreshToolStatuses: (options?: {
    remoteCheck?: boolean;
    manualRemoteCheck?: boolean;
    remoteCheckKind?: ExternalToolKind;
  }) => Promise<void>;
  /** Manually trigger download/update for a given tool kind. */
  downloadToolNow: (kind: ExternalToolKind) => Promise<void>;
  /** Enumerate available candidate binaries for a tool. */
  fetchToolCandidates: (kind: ExternalToolKind) => Promise<ExternalToolCandidate[]>;
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
  const toolStatusesFresh = ref(false);
  let settingsSaveTimer: number | undefined;
  let settingsSaveIdleHandle: number | undefined;
  let toolStatusUnlisten: (() => void) | undefined;
  let lastSavedSettingsSnapshot: string | null = null;
  let awaitingToolsRefreshEvent = false;

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
  const cancelScheduledSave = () => {
    if (settingsSaveTimer !== undefined) {
      window.clearTimeout(settingsSaveTimer);
      settingsSaveTimer = undefined;
    }
    if (settingsSaveIdleHandle !== undefined) {
      // requestIdleCallback is not available in all runtimes (e.g. some test envs / browsers).
      if (typeof window.requestIdleCallback === "function" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(settingsSaveIdleHandle);
      }
      settingsSaveIdleHandle = undefined;
    }
  };

  const markSaved = (serializedOrSettings: string | AppSettings) => {
    lastSavedSettingsSnapshot =
      typeof serializedOrSettings === "string" ? serializedOrSettings : JSON.stringify(serializedOrSettings);
  };

  const ensureAppSettingsLoaded = async () => {
    if (appSettings.value) return;
    if (!hasTauri()) {
      // Web mode: there is no backend settings.json. We still populate an in-memory
      // default so the Settings UI can render (and be screenshot-tested).
      appSettings.value = normalizeLoadedAppSettings(buildWebFallbackAppSettings());
      return;
    }
    const applyLoadedSettings = (settings: AppSettings) => {
      const current = appSettings.value;
      appSettings.value = normalizeLoadedAppSettings(Object.assign({}, settings, current ?? {}));
      lastSavedSettingsSnapshot = JSON.stringify(settings);
      if (settings?.batchCompressDefaults && smartConfig) {
        const existing = smartConfig.value;
        const next = { ...settings.batchCompressDefaults };
        if (existing?.rootPath) {
          next.rootPath = existing.rootPath;
        }
        smartConfig.value = next;
      }
      if (settings?.defaultQueuePresetId && manualJobPresetId) {
        manualJobPresetId.value = settings.defaultQueuePresetId;
      }
    };

    // If main.ts already preloaded app settings (e.g. for locale bootstrapping),
    // reuse that snapshot and avoid a duplicate backend round-trip.
    if (typeof window !== "undefined") {
      const preloaded = window.__FFUI_PRELOADED_APP_SETTINGS__;
      if (preloaded) {
        window.__FFUI_PRELOADED_APP_SETTINGS__ = undefined;
        applyLoadedSettings(preloaded);
        return;
      }
    }
    try {
      const startedAt = startupNowMs();
      const settings = await loadAppSettings();
      const elapsedMs = startupNowMs() - startedAt;

      if (!isTestEnv && (!loggedAppSettingsLoad || elapsedMs >= 200)) {
        loggedAppSettingsLoad = true;
        updateStartupMetrics({ loadAppSettingsMs: elapsedMs });
        if (typeof performance !== "undefined" && "mark" in performance) {
          performance.mark("app_settings_loaded");
        }
        perfLog(`[perf] loadAppSettings: ${elapsedMs.toFixed(1)}ms`);
      }

      // 若在等待后端返回期间，前端已经基于空设置写入了临时 appSettings
      //（例如用户在设置加载完成前就点击了“固定操作栏”等开关），
      //这里需要做一次合并，避免后到达的后端快照把用户刚刚的修改覆盖掉。
      applyLoadedSettings(settings);
    } catch (error) {
      console.error("Failed to load app settings", error);
    }
  };

  const scheduleSaveSettings = () => {
    if (!hasTauri() || !appSettings.value) return;
    settingsSaveError.value = null;
    cancelScheduledSave();

    const runSave = async () => {
      if (!hasTauri() || !appSettings.value) return;
      const current = appSettings.value;
      const serialized = await stringifyJsonAsync(current);
      if (serialized === lastSavedSettingsSnapshot) return;

      isSavingSettings.value = true;
      try {
        // 仅将当前快照持久化，不再用后端返回值覆盖前端状态，
        // 避免在保存过程中引入旧快照把用户刚刚修改的字段（例如 selectionBarPinned）改回去。
        await saveAppSettings(current);
        lastSavedSettingsSnapshot = serialized;
      } catch (error) {
        console.error("Failed to save settings", error);
        settingsSaveError.value =
          t?.("app.settings.saveErrorGeneric") ?? "Failed to save settings. Please try again later.";
      } finally {
        isSavingSettings.value = false;
      }
    };

    // Defer serialization + persistence off the current UI event tick.
    // Prefer requestIdleCallback to keep interactions smooth; fall back to setTimeout for environments without it.
    if (typeof window.requestIdleCallback === "function") {
      settingsSaveIdleHandle = window.requestIdleCallback(
        () => {
          settingsSaveIdleHandle = undefined;
          void runSave();
        },
        { timeout: 1000 },
      );
      return;
    }

    // Minimal async delay so tests can reliably observe saves without needing long timers.
    settingsSaveTimer = window.setTimeout(() => {
      settingsSaveTimer = undefined;
      void runSave();
    }, 0);
  };

  const persistNow = async (nextSettings?: AppSettings) => {
    if (!hasTauri()) return;
    if (nextSettings) {
      appSettings.value = nextSettings;
    }

    const current = nextSettings ?? appSettings.value;
    if (!current) return;

    cancelScheduledSave();
    settingsSaveError.value = null;

    const serialized = await stringifyJsonAsync(current);
    if (serialized === lastSavedSettingsSnapshot) {
      return;
    }

    isSavingSettings.value = true;
    try {
      await saveAppSettings(current);
      lastSavedSettingsSnapshot = serialized;
    } catch (error) {
      console.error("Failed to save settings", error);
      settingsSaveError.value =
        t?.("app.settings.saveErrorGeneric") ?? "Failed to save settings. Please try again later.";
    } finally {
      isSavingSettings.value = false;
    }
  };

  const refreshToolStatuses = async (options?: {
    remoteCheck?: boolean;
    manualRemoteCheck?: boolean;
    remoteCheckKind?: ExternalToolKind;
  }) => {
    if (!hasTauri()) return;
    try {
      const remoteCheck = options?.remoteCheck ?? false;
      const manualRemoteCheck = options?.manualRemoteCheck ?? false;
      const remoteCheckKind = options?.remoteCheckKind;
      updateStartupMetrics({ toolsRefreshRequestedAtMs: startupNowMs() });
      if (typeof performance !== "undefined" && "mark" in performance) {
        performance.mark("tools_refresh_requested");
      }
      const started = await refreshExternalToolStatusesAsync({
        remoteCheck,
        manualRemoteCheck,
        remoteCheckKind,
      });
      awaitingToolsRefreshEvent = started;
    } catch (error) {
      awaitingToolsRefreshEvent = false;
      console.error("Failed to trigger external tool status refresh", error);
    }
  };

  // Subscribe to Tauri IPC events carrying external tool status snapshots so
  // the Settings panel can update in real time without polling.
  onMounted(async () => {
    if (!hasTauri()) return;

    try {
      // Initial snapshot (best-effort).
      const startedAt = startupNowMs();
      const snapshot = await fetchExternalToolStatusesCached();
      toolStatuses.value = Array.isArray(snapshot) ? snapshot : [];
      const elapsedMs = startupNowMs() - startedAt;

      if (!isTestEnv && (!loggedToolStatusLoad || elapsedMs >= 200)) {
        loggedToolStatusLoad = true;
        updateStartupMetrics({ fetchExternalToolStatusesCachedMs: elapsedMs });
        if (typeof performance !== "undefined" && "mark" in performance) {
          performance.mark("tool_statuses_loaded");
        }
        perfLog(`[perf] get_external_tool_statuses_cached: ${elapsedMs.toFixed(1)}ms`);
      }
    } catch (error) {
      console.error("Failed to load initial external tool statuses", error);
    }

    try {
      toolStatusUnlisten = await listen<ExternalToolStatus[]>("ffui://external-tool-status", (event) => {
        if (Array.isArray(event.payload)) {
          toolStatuses.value = event.payload;
          toolStatusesFresh.value = true;
          if (awaitingToolsRefreshEvent) {
            awaitingToolsRefreshEvent = false;
            updateStartupMetrics({ toolsRefreshReceivedAtMs: startupNowMs() });
            if (typeof performance !== "undefined" && "mark" in performance) {
              performance.mark("tools_refresh_received");
            }
          }
        }
      });
    } catch (error) {
      console.error("Failed to subscribe to external tool status events", error);
    }
  });

  const getToolCustomPath = (kind: ExternalToolKind): string => {
    return externalToolCustomPath(appSettings.value, kind);
  };

  const setToolCustomPath = (kind: ExternalToolKind, value: string | number) => {
    setExternalToolCustomPath(appSettings.value, kind, value);
  };

  const downloadToolNow = async (kind: ExternalToolKind) => {
    if (!hasTauri()) return;
    try {
      // `download_external_tool_now` returns an immediate (pre-download) snapshot.
      // The real download/progress/completion states are delivered via the
      // `ffui://external-tool-status` event stream. Do not overwrite the latest
      // event-driven snapshot here, otherwise the UI may flicker (progress bar
      // shows then disappears) or appear to "revert" to an old version.
      await downloadExternalToolNow(kind);
    } catch (error) {
      console.error("Failed to download external tool", error);
      // 具体错误信息已经从后端事件/日志中可见，这里不额外冒泡给用户。
    }
  };

  installExternalToolAutoUpdateWatcher({
    appSettings,
    toolStatuses,
    downloadToolNow,
    hasTauri,
  });

  const getToolDisplayName = (kind: ExternalToolKind): string => {
    return externalToolDisplayName(kind);
  };

  const fetchToolCandidates = async (kind: ExternalToolKind): Promise<ExternalToolCandidate[]> => {
    if (!hasTauri()) return [];
    try {
      return await fetchExternalToolCandidates(kind);
    } catch (error) {
      console.error("Failed to load external tool candidates", error);
      return [];
    }
  };

  const cleanup = () => {
    cancelScheduledSave();
    if (toolStatusUnlisten) {
      toolStatusUnlisten();
      toolStatusUnlisten = undefined;
    }
  };

  onUnmounted(() => {
    cleanup();
  });

  return {
    // State
    appSettings,
    isSavingSettings,
    settingsSaveError,
    toolStatuses,
    toolStatusesFresh,

    // Methods
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
    persistNow,
    markSaved,
    refreshToolStatuses,
    downloadToolNow,
    fetchToolCandidates,
    getToolDisplayName,
    getToolCustomPath,
    setToolCustomPath,
    cleanup,
  };
}

export default useAppSettings;
