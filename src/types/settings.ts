import type {
  ExternalToolSettings,
  TaskbarProgressMode,
  TaskbarProgressScope,
} from "./tools";
import type { SmartScanConfig } from "./smart-scan";

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

export interface AppSettings {
  tools: ExternalToolSettings;
  smartScanDefaults: SmartScanConfig;
  /** Optional app updater settings and cached metadata. */
  updater?: AppUpdaterSettings;
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
  /** Optional upper bound for concurrent ffmpeg jobs; 0 or undefined means auto. */
  maxParallelJobs?: number;
  /** Optional interval in milliseconds between backend progress updates for ffmpeg jobs (bundled binary only). */
  progressUpdateIntervalMs?: number;
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
}
