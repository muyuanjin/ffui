import type { ExternalToolSettings, TaskbarProgressMode, TaskbarProgressScope } from "./tools";
import type { BatchCompressConfig } from "./batch-compress";
import type { OutputPolicy } from "./output-policy";

export type QueuePersistenceMode = "none" | "crashRecoveryLite" | "crashRecoveryFull";

export interface CrashRecoveryLogRetention {
  /** Maximum number of per-job terminal log files to keep on disk. */
  maxFiles?: number;
  /** Maximum total size in MB for all terminal log files. */
  maxTotalMb?: number;
}

export interface AppUpdaterSettings {
  /** When true (default), check for app updates on startup (TTL-based). */
  autoCheck?: boolean;
  /** Unix epoch timestamp in milliseconds when the last update check finished. */
  lastCheckedAtMs?: number;
  /** Latest known available version when the last check found an update. */
  availableVersion?: string;
}

/** 预设排序方式 */
export type PresetSortMode = "manual" | "usage" | "ratio" | "speed" | "name";

/** 预设面板视图模式 */
export type PresetViewMode = "grid" | "compact";

/** UI font family preference (applies globally). */
export type UiFontFamily = "system" | "sans" | "mono";

export type TranscodeParallelismMode = "unified" | "split";

export type NetworkProxyMode = "none" | "system" | "custom";

export interface NetworkProxySettings {
  mode: NetworkProxyMode;
  /** Required when mode is custom. */
  proxyUrl?: string;
}

export interface AppSettings {
  tools: ExternalToolSettings;
  batchCompressDefaults: BatchCompressConfig;
  /** Preferred UI locale (e.g. "en", "zh-CN"). */
  locale?: string;
  /** Optional app updater settings and cached metadata. */
  updater?: AppUpdaterSettings;
  /** Optional network proxy settings. When omitted, behaves like "system". */
  networkProxy?: NetworkProxySettings;
  /** Global UI scale in percent (e.g. 100 = default, 110 = larger). */
  uiScalePercent?: number;
  /** Global base UI font size in percent (e.g. 100 = default, 110 = larger). */
  uiFontSizePercent?: number;
  /** Global UI font family preference (system/sans/mono). */
  uiFontFamily?: UiFontFamily;
  /** Optional specific UI font family name (e.g. "Consolas", "Microsoft YaHei"). */
  uiFontName?: string;
  /** Optional open-source font id to download/cache and use globally. */
  uiFontDownloadId?: string;
  /** Absolute path to an imported user font file under the app data directory. */
  uiFontFilePath?: string;
  /** Optional original filename of the imported UI font (for display purposes). */
  uiFontFileSourceName?: string;
  /** Global preview capture position as a percentage of video duration (0-100). */
  previewCapturePercent: number;
  /** When true, enable developer features such as opening devtools from the UI. */
  developerModeEnabled?: boolean;
  /** Optional default preset id used for manual queue jobs. */
  defaultQueuePresetId?: string;
  /** Optional preset sort mode for the presets panel and dropdown. */
  presetSortMode?: PresetSortMode;
  /** Optional preset view mode for the presets panel (grid or compact). */
  presetViewMode?: PresetViewMode;
  /** Concurrency strategy for transcoding workers (unified cap or CPU/HW split). */
  parallelismMode?: TranscodeParallelismMode;
  /** Optional upper bound for concurrent ffmpeg jobs; must be >= 1 when set (unified mode). */
  maxParallelJobs?: number;
  /** Optional upper bound for concurrent CPU/software-encoded jobs; must be >= 1 when set (split mode). */
  maxParallelCpuJobs?: number;
  /** Optional upper bound for concurrent hardware-encoded jobs; must be >= 1 when set (split mode). */
  maxParallelHwJobs?: number;
  /** Optional interval in milliseconds between backend progress updates for ffmpeg jobs (bundled binary only). */
  progressUpdateIntervalMs?: number;
  /**
   * When true (default), exiting the app while jobs are running will prompt the user and can attempt
   * a best-effort "pause on exit" flow so precise resume remains usable after restart.
   */
  exitAutoWaitEnabled?: boolean;
  /** Timeout (seconds) for the "pause on exit" flow before giving up and allowing the app to close. */
  exitAutoWaitTimeoutSeconds?: number;
  /** Optional interval in milliseconds between system metrics samples for the performance monitor. */
  metricsIntervalMs?: number;
  /** Aggregation mode for computing Windows taskbar progress from the queue. */
  taskbarProgressMode?: TaskbarProgressMode;
  /** Aggregation scope for Windows taskbar progress. */
  taskbarProgressScope?: TaskbarProgressScope;
  /** Queue persistence strategy for crash recovery. */
  queuePersistenceMode?: QueuePersistenceMode;
  /** Retention limits for per-job terminal log files under CrashRecoveryFull. */
  crashRecoveryLogRetention?: CrashRecoveryLogRetention;
  /** One-time onboarding flag; when true, the smart preset/tool onboarding will not auto-run again. */
  onboardingCompleted?: boolean;
  /** Whether the queue selection bar should remain visible even when no jobs are selected. */
  selectionBarPinned?: boolean;
  /** Output policy for manual queue enqueues (container/dir/name/timestamps). */
  queueOutputPolicy?: OutputPolicy;
}
