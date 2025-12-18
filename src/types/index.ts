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
  QueueViewMode,
  QueueMode,
  QueueProgressStyle,
  MediaInfo,
  JobWarning,
  WaitMetadata,
  JobCompareOutput,
  JobCompareSources,
  TranscodeJob,
  TranscodeJobLite,
  QueueState,
  // Lightweight queue snapshot shape used for startup and high-frequency updates.
  // Kept as a separate alias so existing imports remain valid while sharing the
  // same underlying structure as QueueState.
  QueueStateLite,
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
  UiFontFamily,
  NetworkProxyMode,
  NetworkProxySettings,
} from "./settings";
