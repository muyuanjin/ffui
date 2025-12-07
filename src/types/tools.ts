export interface DownloadedToolInfo {
  /** Human-readable version string for the downloaded tool, e.g. "6.0". */
  version?: string;
  /** Optional tag or build identifier, e.g. "b6.0" for ffmpeg-static. */
  tag?: string;
  /** Source URL used to download this binary. */
  sourceUrl?: string;
  /** Unix epoch timestamp in milliseconds when the download completed. */
  downloadedAt?: number;
}

export interface DownloadedToolState {
  ffmpeg?: DownloadedToolInfo;
  ffprobe?: DownloadedToolInfo;
  avifenc?: DownloadedToolInfo;
}

export type TaskbarProgressMode = "bySize" | "byDuration" | "byEstimatedTime";

export interface ExternalToolSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  avifencPath?: string;
  autoDownload: boolean;
  autoUpdate: boolean;
  /** Optional metadata about binaries that were auto-downloaded by the app. */
  downloaded?: DownloadedToolState;
}

export type ExternalToolKind = "ffmpeg" | "ffprobe" | "avifenc";

export interface ExternalToolStatus {
  kind: ExternalToolKind;
  resolvedPath?: string;
  source?: string;
  version?: string;
  /** Latest remote version string when known (for update hints). */
  remoteVersion?: string;
  updateAvailable: boolean;
  autoDownloadEnabled: boolean;
  autoUpdateEnabled: boolean;
  /** True when the backend is currently auto-downloading this tool. */
  downloadInProgress: boolean;
  /** Optional percentage progress (0-100); when undefined, treat as indeterminate spinner. */
  downloadProgress?: number;
  /** Total bytes downloaded so far for the current auto-download, when known. */
  downloadedBytes?: number;
  /** Total expected size in bytes for the current auto-download when known. */
  totalBytes?: number;
  /** Smoothed download speed in bytes per second when known. */
  bytesPerSecond?: number;
  /** Last error message emitted while trying to download or update this tool. */
  lastDownloadError?: string;
  /** Last informational message about download/update activity for this tool. */
  lastDownloadMessage?: string;
}
