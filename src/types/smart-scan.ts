import type { TranscodeJob } from "./queue";

/** 保留结果的条件类型 */
export type SavingConditionType = "ratio" | "absoluteSize";

/** 文件类型筛选配置 */
export interface FileTypeFilter {
  /** 是否启用该类型 */
  enabled: boolean;
  /** 具体的文件扩展名（不含点号），如 ["mp4", "mkv"] */
  extensions: string[];
}

export interface SmartScanConfig {
  /** 扫描根路径 */
  rootPath?: string;
  /** 是否替换原文件（默认 true） */
  replaceOriginal: boolean;
  /** 视频最小检测体积 (MB) */
  minVideoSizeMB: number;
  /** 图片最小检测体积 (KB) */
  minImageSizeKB: number;
  /** 音频最小检测体积 (KB) */
  minAudioSizeKB: number;
  /** 保留结果的条件类型 */
  savingConditionType: SavingConditionType;
  /** 保留结果所需的最低压缩率（0-1，仅当 savingConditionType 为 ratio 时使用） */
  minSavingRatio: number;
  /** 保留结果所需的最低节省空间 (MB，仅当 savingConditionType 为 absoluteSize 时使用) */
  minSavingAbsoluteMB: number;
  /** 图片目标格式 */
  imageTargetFormat: "avif" | "webp";
  /** 视频转码预设 ID */
  videoPresetId: string;
  /** 音频转码预设 ID（可选，为空时使用默认音频压缩） */
  audioPresetId?: string;
  /** 视频文件类型筛选 */
  videoFilter: FileTypeFilter;
  /** 图片文件类型筛选 */
  imageFilter: FileTypeFilter;
  /** 音频文件类型筛选 */
  audioFilter: FileTypeFilter;
}

export interface AutoCompressResult {
  rootPath: string;
  jobs: TranscodeJob[];
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  batchId: string;
  startedAtMs: number;
  completedAtMs: number;
}

export interface AutoCompressProgress {
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  batchId: string;
  /** 批次完成时间（毫秒时间戳），为 0 或未提供时表示尚未完成或未知。 */
  completedAtMs?: number;
}

/**
 * Frontend-side aggregation of a Smart Scan batch. A single batch can contain
 * many TranscodeJob entries that share the same batchId; this type represents
 * the composite view rendered in the queue (list/grid/icon views).
 */
export interface CompositeSmartScanTask {
  batchId: string;
  rootPath: string;
  jobs: TranscodeJob[];
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
  /** Aggregated overall progress for the batch in [0, 100]. */
  overallProgress: number;
  /** Latest active job in this batch, if any. */
  currentJob: TranscodeJob | null;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
}
