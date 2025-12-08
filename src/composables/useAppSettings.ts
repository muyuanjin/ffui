import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import type {
  AppSettings,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  SmartScanConfig,
} from "@/types";
import {
  hasTauri,
  loadAppSettings,
  saveAppSettings,
  fetchExternalToolStatuses,
  fetchExternalToolCandidates,
  downloadExternalToolNow,
} from "@/lib/backend";
import { listen } from "@tauri-apps/api/event";

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
  let settingsSaveTimer: number | undefined;
  let toolStatusUnlisten: (() => void) | undefined;
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
        const existing = smartConfig.value;
        const next = { ...settings.smartScanDefaults };
        // 若用户已通过拖拽等方式选择了目录，保留当前的 rootPath，避免加载设置时覆盖预填路径
        if (existing?.rootPath) {
          next.rootPath = existing.rootPath;
        }
        smartConfig.value = next;
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

  // Subscribe to Tauri IPC events carrying external tool status snapshots so
  // the Settings panel can update in real time without polling.
  onMounted(async () => {
    if (!hasTauri()) return;

    try {
      // Initial snapshot (best-effort).
      toolStatuses.value = await fetchExternalToolStatuses();
    } catch (error) {
      console.error("Failed to load initial external tool statuses", error);
    }

    try {
      toolStatusUnlisten = await listen<ExternalToolStatus[]>(
        "ffui://external-tool-status",
        (event) => {
          if (Array.isArray(event.payload)) {
            toolStatuses.value = event.payload;
          }
        },
      );
    } catch (error) {
      console.error("Failed to subscribe to external tool status events", error);
    }
  });

  const getToolDisplayName = (kind: ExternalToolKind): string => {
    if (kind === "ffmpeg") return "FFmpeg";
    if (kind === "ffprobe") return "ffprobe";
    if (kind === "avifenc") return "avifenc";
    return kind;
  };

  const getToolCustomPath = (kind: ExternalToolKind): string => {
    const settings = appSettings.value;
    if (!settings) return "";
    const tools = (settings as any).tools as import("@/types").ExternalToolSettings | undefined;
    if (!tools) return "";
    if (kind === "ffmpeg") return tools.ffmpegPath ?? "";
    if (kind === "ffprobe") return tools.ffprobePath ?? "";
    if (kind === "avifenc") return tools.avifencPath ?? "";
    return "";
  };

  const setToolCustomPath = (kind: ExternalToolKind, value: string | number) => {
    const settings = appSettings.value;
    if (!settings) return;
    const root = settings as any;
    if (!root.tools) {
      root.tools = {
        autoDownload: false,
        autoUpdate: false,
      } as import("@/types").ExternalToolSettings;
    }
    const tools = root.tools as import("@/types").ExternalToolSettings;
    // Switching to a manually specified path should implicitly move the
    // management mode to “手动管理”，以免后续自动下载/更新悄悄覆盖用户选择。
    tools.autoDownload = false;
    tools.autoUpdate = false;
    const normalized = String(value ?? "").trim();
    if (kind === "ffmpeg") {
      tools.ffmpegPath = normalized || undefined;
    } else if (kind === "ffprobe") {
      tools.ffprobePath = normalized || undefined;
    } else if (kind === "avifenc") {
      tools.avifencPath = normalized || undefined;
    }
  };

  const downloadToolNow = async (kind: ExternalToolKind) => {
    if (!hasTauri()) return;
    try {
      toolStatuses.value = await downloadExternalToolNow(kind);
    } catch (error) {
      console.error("Failed to download external tool", error);
      // 具体错误信息已经从后端事件/日志中可见，这里不额外冒泡给用户。
    }
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

  // When automatic external tool updates are enabled, watch for tools that
  // report `updateAvailable` and trigger a background download using the same
  // Tauri command as the manual “下载/更新”按钮。This keeps queue tasks
  // unblocked while still keeping binaries fresh.
  const autoUpdateInFlight = new Set<ExternalToolKind>();
  // Track the last remote version we have already attempted to auto‑update to
  // for each tool kind within this session. This prevents accidental循环下载
  // when `updateAvailable` 状态由于网络/缓存等原因长期保持为 true。
  const autoUpdatedRemoteVersions = new Map<ExternalToolKind, string | null>();
  watch(
    () => ({
      statuses: toolStatuses.value,
      autoUpdateEnabled:
        (appSettings.value as any)?.tools?.autoUpdate ?? false,
    }),
    async ({ statuses, autoUpdateEnabled }) => {
      if (!hasTauri() || !autoUpdateEnabled) return;
      for (const tool of statuses) {
        const remoteVersion = tool.remoteVersion ?? null;
        const lastAttempted = autoUpdatedRemoteVersions.get(tool.kind) ?? null;

        // If a download is already in progress for this tool, treat the
        // corresponding remoteVersion as "attempted" so we do not schedule a
        // second auto‑update in parallel. This covers cases where the user
        // manually点击“下载/更新”或队列在后台触发了下载。
        if (tool.downloadInProgress) {
          if (remoteVersion && lastAttempted == null) {
            autoUpdatedRemoteVersions.set(tool.kind, remoteVersion);
          }
          continue;
        }

        if (!tool.updateAvailable) continue;
        // Skip when we have already attempted to auto‑update to the same
        // remote version in this session. 即便后端因为网络/缓存原因持续标记
        // updateAvailable=true，也只会尝试一次，避免“死循环”式重复下载。
        if (remoteVersion && lastAttempted === remoteVersion) continue;
        if (autoUpdateInFlight.has(tool.kind)) continue;
        autoUpdateInFlight.add(tool.kind);
        try {
          await downloadToolNow(tool.kind);
          // After the download request completes, refresh the last-attempted
          // version from the latest status snapshot so that dynamic remote
          // metadata（例如 GitHub Releases 最新 tag）不会因为 remoteVersion
          // 变化而在同一版本上再次触发下载。
          const latest = toolStatuses.value.find((t) => t.kind === tool.kind);
          const latestRemoteVersion = latest?.remoteVersion ?? remoteVersion;
          if (latestRemoteVersion) {
            autoUpdatedRemoteVersions.set(tool.kind, latestRemoteVersion);
          }
        } catch (error) {
          console.error("Failed to auto-update external tool", error);
        } finally {
          autoUpdateInFlight.delete(tool.kind);
        }
      }
    },
    { deep: false },
  );

  const cleanup = () => {
    if (settingsSaveTimer !== undefined) {
      window.clearTimeout(settingsSaveTimer);
      settingsSaveTimer = undefined;
    }
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

    // Methods
    ensureAppSettingsLoaded,
    scheduleSaveSettings,
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
