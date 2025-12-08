import type { ExternalToolSettings, TaskbarProgressMode } from "./tools";
import type { SmartScanConfig } from "./smart-scan";

export type QueuePersistenceMode = "none" | "crashRecovery";

export interface AppSettings {
  tools: ExternalToolSettings;
  smartScanDefaults: SmartScanConfig;
  /** Global preview capture position as a percentage of video duration (0-100). */
  previewCapturePercent: number;
  /** When true, enable developer features such as opening devtools from the UI. */
  developerModeEnabled?: boolean;
  /** Optional default preset id used for manual queue jobs. */
  defaultQueuePresetId?: string;
  /** Optional upper bound for concurrent ffmpeg jobs; 0 or undefined means auto. */
  maxParallelJobs?: number;
  /** Optional interval in milliseconds between backend progress updates for ffmpeg jobs (bundled binary only). */
  progressUpdateIntervalMs?: number;
  /** Optional interval in milliseconds between system metrics samples for the performance monitor. */
  metricsIntervalMs?: number;
  /** Aggregation mode for computing Windows taskbar progress from the queue. */
  taskbarProgressMode?: TaskbarProgressMode;
  /** Queue persistence strategy for crash recovery. */
  queuePersistenceMode?: QueuePersistenceMode;
  /** One-time onboarding flag; when true, the smart preset/tool onboarding will not auto-run again. */
  onboardingCompleted?: boolean;
}
