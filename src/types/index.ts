// FFmpeg preset and configuration types
export type {
  EncoderType,
  AudioCodecType,
  RateControlMode,
  AudioLoudnessProfile,
  OverwriteBehavior,
  LogLevel,
  GlobalConfig,
  SeekMode,
  DurationMode,
  InputTimelineConfig,
  MappingConfig,
  SubtitleStrategy,
  SubtitlesConfig,
  VideoConfig,
  AudioConfig,
  FilterConfig,
  ContainerConfig,
  HardwareConfig,
  PresetStats,
  FFmpegPreset,
} from "./ffmpeg";

// Queue and transcode job types
export type {
  JobStatus,
  JobType,
  JobSource,
  EnqueueTranscodeJobRequest,
  EnqueueTranscodeJobsRequest,
  QueueViewMode,
  QueueMode,
  QueueBulkActionKind,
  QueueProgressStyle,
  MediaInfo,
  JobWarning,
  JobLogLine,
  JobLogLineLike,
  JobRun,
  WaitMetadata,
  JobCompareOutput,
  JobCompareSources,
  TranscodeJob,
  TranscodeJobUiLite,
  TranscodeJobLite,
  QueueState,
  // Lightweight queue snapshot shape used for startup and high-frequency updates.
  // Kept as a separate alias so existing imports remain valid while sharing the
  // same underlying structure as QueueState.
  QueueStateUiLite,
  QueueStateLite,
  QueueStateLiteDelta,
  TranscodeJobLiteDeltaPatch,
  QueueStartupHintKind,
  QueueStartupHint,
} from "./queue";

// System monitoring types
export type {
  CpuUsageSnapshot,
  GpuUsageSnapshot,
  CpuMetrics,
  MemoryMetrics,
  DiskIoMetrics,
  DiskMetrics,
  NetworkInterfaceMetrics,
  NetworkMetrics,
  SystemMetricsSnapshot,
  TranscodeActivityToday,
} from "./monitoring";

// External tools types
export type {
  DownloadedToolInfo,
  DownloadedToolState,
  TaskbarProgressMode,
  TaskbarProgressScope,
  ExternalToolSettings,
  ExternalToolKind,
  ExternalToolStatus,
  ExternalToolCandidate,
} from "./tools";

// Batch Compress types
export type {
  BatchCompressConfig,
  AutoCompressResult,
  AutoCompressProgress,
  CompositeBatchCompressTask,
} from "./batch-compress";

// Output policy types
export type {
  OutputPolicy,
  OutputContainerPolicy,
  OutputDirectoryPolicy,
  OutputFilenameAppend,
  OutputFilenamePolicy,
  OutputFilenameRegexReplace,
} from "./output-policy";

// Application settings
export type {
  AppSettings,
  PresetSortMode,
  PresetViewMode,
  PresetCardFooterLayout,
  PresetCardFooterItemKey,
  PresetCardFooterSettings,
  UiFontFamily,
  NetworkProxyMode,
  NetworkProxySettings,
} from "./settings";

// App exit + graceful shutdown types
export type { ExitAutoWaitOutcome, ExitRequestPayload } from "./app-exit";

// Data root + config bundle types
export type { DataRootMode, DataRootInfo, ConfigBundleExportResult, ConfigBundleImportResult } from "./data-root";

// Preset-only bundle types
export type { PresetBundle, PresetBundleExportResult } from "./preset-bundle";

// Preset template validation
export type { PresetTemplateValidationOutcome, PresetTemplateValidationResult } from "./preset-template-validation";

// Shared type utilities (type-only).
export type { DeepWritable } from "./typeUtils";

// i18n type helpers (type-only).
export type { Translate } from "./i18n";
