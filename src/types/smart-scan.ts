import type { TranscodeJob } from "./queue";

export interface SmartScanConfig {
  minImageSizeKB: number;
  minVideoSizeMB: number;
  minSavingRatio: number;
  imageTargetFormat: "avif" | "webp";
  videoPresetId: string;
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
