import { watch, type Ref } from "vue";
import type { AppSettings, ExternalToolKind, ExternalToolSettings, ExternalToolStatus } from "@/types";

export const externalToolDisplayName = (kind: ExternalToolKind): string => {
  if (kind === "ffmpeg") return "FFmpeg";
  if (kind === "ffprobe") return "ffprobe";
  if (kind === "avifenc") return "avifenc";
  return kind;
};

export const externalToolCustomPath = (settings: AppSettings | null, kind: ExternalToolKind): string => {
  const tools = settings?.tools;
  if (!tools) return "";
  if (kind === "ffmpeg") return tools.ffmpegPath ?? "";
  if (kind === "ffprobe") return tools.ffprobePath ?? "";
  if (kind === "avifenc") return tools.avifencPath ?? "";
  return "";
};

export const setExternalToolCustomPath = (
  settings: AppSettings | null,
  kind: ExternalToolKind,
  value: string | number,
) => {
  if (!settings) return;

  if (!settings.tools) {
    settings.tools = {
      autoDownload: false,
      autoUpdate: false,
    } as ExternalToolSettings;
  }

  const tools = settings.tools as ExternalToolSettings;

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

export const installExternalToolAutoUpdateWatcher = (options: {
  appSettings: Ref<AppSettings | null>;
  toolStatuses: Ref<ExternalToolStatus[]>;
  downloadToolNow: (kind: ExternalToolKind) => Promise<void>;
  hasTauri: () => boolean;
}) => {
  const { appSettings, toolStatuses, downloadToolNow, hasTauri } = options;

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
      autoUpdateEnabled: appSettings.value?.tools?.autoUpdate ?? false,
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
};
