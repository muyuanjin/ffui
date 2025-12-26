import { computed, ref, type Ref, type ComputedRef } from "vue";
import type {
  TranscodeJob,
  BatchCompressConfig,
  CompositeBatchCompressTask,
  JobStatus,
  JobType,
  FFmpegPreset,
  Translate,
} from "@/types";
import { DEFAULT_BATCH_COMPRESS_CONFIG, EXTENSIONS } from "@/constants";
import { hasTauri, runAutoCompress } from "@/lib/backend";

// ----- Types -----

export interface BatchCompressBatchMeta {
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

export interface BatchCompressBatchSnapshot {
  batchId: string;
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

// ----- Composable -----

export interface UseBatchCompressOptions {
  /** The list of jobs. */
  jobs: Ref<TranscodeJob[]>;
  /** Batch Compress jobs ref. */
  batchCompressJobs: Ref<TranscodeJob[]>;
  /** Available presets. */
  presets: Ref<FFmpegPreset[]>;
  /** Queue error ref. */
  queueError: Ref<string | null>;
  /** Last dropped root path. */
  lastDroppedRoot: Ref<string | null>;
  /** Active tab ref. */
  activeTab: Ref<string>;
  /** Optional i18n translation function. */
  t?: Translate;
}

export interface UseBatchCompressReturn {
  // ----- State -----
  /** Batch Compress configuration. */
  smartConfig: Ref<BatchCompressConfig>;
  /** Whether batch compress dialog is visible. */
  showBatchCompress: Ref<boolean>;
  /** Batch Compress batch metadata by batch ID. */
  batchCompressBatchMeta: Ref<Record<string, BatchCompressBatchMeta>>;
  /** Expanded batch IDs (for accordion UI). */
  expandedBatchIds: Ref<Set<string>>;

  // ----- Computed -----
  /** Composite batch compress tasks for display. */
  compositeBatchCompressTasks: ComputedRef<CompositeBatchCompressTask[]>;
  /** Map of batch ID to composite task. */
  compositeTasksById: ComputedRef<Map<string, CompositeBatchCompressTask>>;
  /** Whether there are any batch compress batches. */
  hasBatchCompressBatches: ComputedRef<boolean>;

  // ----- Methods -----
  /** Apply batch metadata snapshot from backend. */
  applyBatchCompressBatchMetaSnapshot: (snapshot: BatchCompressBatchSnapshot) => void;
  /** Run batch compress (mock for non-Tauri). */
  runBatchCompressMock: (config: BatchCompressConfig) => void;
  /** Run batch compress (real). */
  runBatchCompress: (config: BatchCompressConfig) => Promise<void>;
  /** Start batch compress (open dialog or wizard). */
  startBatchCompress: () => Promise<void>;
}

/**
 * Composable for batch compress (auto-compress) functionality.
 */
export function useBatchCompress(options: UseBatchCompressOptions): UseBatchCompressReturn {
  const {
    jobs,
    // batchCompressJobs and presets are provided for future use but not currently needed
    queueError,
    lastDroppedRoot,
    activeTab,
    t,
  } = options;

  // ----- State -----
  const smartConfig = ref<BatchCompressConfig>({ ...DEFAULT_BATCH_COMPRESS_CONFIG });
  const showBatchCompress = ref(false);
  const batchCompressBatchMeta = ref<Record<string, BatchCompressBatchMeta>>({});
  const expandedBatchIds = ref<Set<string>>(new Set());

  // ----- Batch Meta Methods -----
  const applyBatchCompressBatchMetaSnapshot = (snapshot: BatchCompressBatchSnapshot) => {
    if (!snapshot.batchId) return;

    const prev = batchCompressBatchMeta.value[snapshot.batchId];

    const next: BatchCompressBatchMeta = {
      rootPath: snapshot.rootPath || prev?.rootPath || "",
      totalFilesScanned: Math.max(prev?.totalFilesScanned ?? 0, snapshot.totalFilesScanned),
      totalCandidates: Math.max(prev?.totalCandidates ?? 0, snapshot.totalCandidates),
      totalProcessed: Math.max(prev?.totalProcessed ?? 0, snapshot.totalProcessed),
      startedAtMs: prev?.startedAtMs ?? snapshot.startedAtMs,
      completedAtMs: snapshot.completedAtMs ?? prev?.completedAtMs,
    };

    batchCompressBatchMeta.value = {
      ...batchCompressBatchMeta.value,
      [snapshot.batchId]: next,
    };

    if (!prev && !expandedBatchIds.value.has(snapshot.batchId)) {
      const expanded = new Set(expandedBatchIds.value);
      expanded.add(snapshot.batchId);
      expandedBatchIds.value = expanded;
    }
  };

  // ----- Computed -----
  const compositeBatchCompressTasks = computed<CompositeBatchCompressTask[]>(() => {
    const byBatch: Record<string, { jobs: TranscodeJob[] }> = {};

    for (const job of jobs.value) {
      const batchId = job.batchId;
      if (!batchId) continue;
      if (!byBatch[batchId]) {
        byBatch[batchId] = { jobs: [] };
      }
      byBatch[batchId].jobs.push(job);
    }

    const metaById = batchCompressBatchMeta.value;
    const allBatchIds = new Set<string>([...Object.keys(metaById), ...Object.keys(byBatch)]);

    const tasks: CompositeBatchCompressTask[] = [];

    for (const batchId of allBatchIds) {
      const batchJobs = byBatch[batchId]?.jobs ?? [];
      const meta = metaById[batchId];
      const totalCount = batchJobs.length;

      let completedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let cancelledCount = 0;
      let progressSum = 0;
      let currentJob: TranscodeJob | null = null;

      for (const job of batchJobs) {
        switch (job.status) {
          case "completed":
            completedCount += 1;
            progressSum += 1;
            break;
          case "skipped":
            skippedCount += 1;
            progressSum += 1;
            break;
          case "failed":
            failedCount += 1;
            progressSum += 1;
            break;
          case "cancelled":
            cancelledCount += 1;
            progressSum += 1;
            break;
          case "processing":
          case "paused":
            progressSum += (job.progress ?? 0) / 100;
            if (!currentJob || (job.startTime ?? 0) > (currentJob.startTime ?? 0)) {
              currentJob = job;
            }
            break;
          default:
            break;
        }
      }

      const locallyProcessedCount = completedCount + skippedCount + failedCount + cancelledCount;

      const totalCandidates = meta?.totalCandidates ?? totalCount;
      const totalProcessed = meta?.totalProcessed ?? locallyProcessedCount;

      const hasQueuedChildren = batchJobs.length > 0;
      const batchComplete =
        // 有候选时：processed 覆盖所有候选视为完成
        (totalCandidates > 0 && totalProcessed >= totalCandidates) ||
        // 无候选时：仅依据 completedAtMs 是否存在来判断是否“空批次已跑完”
        (totalCandidates === 0 && !!meta?.completedAtMs);

      if (!hasQueuedChildren && batchComplete) {
        // 当该批次的所有子任务都已经处理完并且从队列中移除，或者这是一个“空候选但已完成”的批次时，
        // 不再渲染空的复合任务卡片，避免队列中出现无法选中/删除的“空压缩任务”。
        // Batch Compress 元数据仍保留在前端状态中，用于后续统计或调试。
        continue;
      }

      const overallProgress = totalCount > 0 ? (progressSum / totalCount) * 100 : 0;

      const rootPathFromMeta = meta?.rootPath;
      let rootPath = rootPathFromMeta ?? "";
      if (!rootPath) {
        const first = batchJobs[0];
        const raw = first?.inputPath || first?.filename || "";
        if (raw) {
          const normalized = raw.replace(/\\/g, "/");
          const lastSlash = normalized.lastIndexOf("/");
          rootPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized;
        }
      }

      tasks.push({
        batchId,
        rootPath,
        jobs: batchJobs,
        totalFilesScanned: meta?.totalFilesScanned ?? totalCount,
        totalCandidates,
        totalProcessed,
        startedAtMs: meta?.startedAtMs,
        completedAtMs: meta?.completedAtMs,
        overallProgress,
        currentJob,
        completedCount,
        skippedCount,
        failedCount,
        cancelledCount,
        totalCount,
      });
    }

    return tasks;
  });

  const hasBatchCompressBatches = computed(() => {
    return Object.keys(batchCompressBatchMeta.value).length > 0;
  });

  const compositeTasksById = computed(() => {
    const map = new Map<string, CompositeBatchCompressTask>();
    for (const task of compositeBatchCompressTasks.value) {
      map.set(task.batchId, task);
    }
    return map;
  });

  // ----- Scan Methods -----
  const runBatchCompressMock = (config: BatchCompressConfig) => {
    smartConfig.value = { ...config };
    showBatchCompress.value = false;
    activeTab.value = "queue";

    const found: TranscodeJob[] = [];
    const count = 5 + Math.floor(Math.random() * 5);
    const batchId = `mock-batch-${Date.now().toString(36)}`;

    const enabledKinds: JobType[] = [];
    if (config.videoFilter.enabled) enabledKinds.push("video");
    if (config.imageFilter.enabled) enabledKinds.push("image");
    if (config.audioFilter.enabled) enabledKinds.push("audio");
    const kinds: JobType[] = enabledKinds.length > 0 ? enabledKinds : (["video", "image"] as JobType[]);

    for (let i = 0; i < count; i += 1) {
      const kind: JobType = kinds[Math.floor(Math.random() * kinds.length)];
      let filename = "";
      let size = 0;
      let codec = "";
      let status: JobStatus = "queued";
      let skipReason = "";

      if (kind === "video") {
        const ext = EXTENSIONS.videos[Math.floor(Math.random() * EXTENSIONS.videos.length)];
        filename = `video_scanned_${Math.floor(Math.random() * 1000)}${ext}`;
        size = 10 + Math.random() * 200;
        codec = Math.random() > 0.7 ? "hevc" : "h264";

        if (codec === "hevc" || codec === "av1") {
          status = "skipped";
          skipReason = `Codec is already ${codec}`;
        } else if (size < config.minVideoSizeMB) {
          status = "skipped";
          skipReason = `Size < ${config.minVideoSizeMB}MB`;
        }
      } else if (kind === "image") {
        const ext = EXTENSIONS.images[Math.floor(Math.random() * EXTENSIONS.images.length)];
        const isAvif = Math.random() > 0.9;
        filename = `photo_scan_${Math.floor(Math.random() * 1000)}${isAvif ? ".avif" : ext}`;
        size = (10 + Math.random() * 5000) / 1024;
        codec = isAvif ? "avif" : "jpeg";

        if (filename.endsWith(".avif")) {
          status = "skipped";
          skipReason = "Already AVIF";
        } else if (size * 1024 < config.minImageSizeKB) {
          status = "skipped";
          skipReason = `Size < ${config.minImageSizeKB}KB`;
        }
      } else {
        const ext = EXTENSIONS.audios[Math.floor(Math.random() * EXTENSIONS.audios.length)];
        filename = `audio_scan_${Math.floor(Math.random() * 1000)}${ext}`;
        size = (500 + Math.random() * 9500) / 1024; // 粗略模拟 KB → MB
        codec = ext.replace(".", "");

        if (size * 1024 < config.minAudioSizeKB) {
          status = "skipped";
          skipReason = `Size < ${config.minAudioSizeKB}KB`;
        }
      }

      const presetIdForKind = kind === "audio" ? config.audioPresetId || "" : config.videoPresetId;

      found.push({
        id: `${Date.now().toString()}-${i}`,
        filename,
        type: kind,
        source: "batch_compress",
        originalSizeMB: size,
        originalCodec: codec,
        presetId: presetIdForKind,
        status,
        progress: 0,
        logs: [],
        skipReason,
        batchId,
      });
    }

    batchCompressBatchMeta.value = {
      ...batchCompressBatchMeta.value,
      [batchId]: {
        rootPath: "",
        totalFilesScanned: found.length,
        totalCandidates: found.length,
        totalProcessed: found.filter((j) => j.status === "completed").length,
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
      },
    };

    jobs.value = [...found, ...jobs.value];
  };

  const runBatchCompress = async (config: BatchCompressConfig) => {
    smartConfig.value = { ...config };
    showBatchCompress.value = false;
    activeTab.value = "queue";

    if (!hasTauri()) {
      runBatchCompressMock(config);
      return;
    }

    // 优先使用配置中的路径，其次使用拖拽路径
    const root = config.rootPath?.trim() || lastDroppedRoot.value;
    if (root) {
      // 更新 lastDroppedRoot 以便后续使用
      lastDroppedRoot.value = root;

      try {
        const result = await runAutoCompress(root, config);
        const batchId = result.batchId;

        applyBatchCompressBatchMetaSnapshot({
          batchId,
          rootPath: result.rootPath,
          totalFilesScanned: result.totalFilesScanned,
          totalCandidates: result.totalCandidates,
          totalProcessed: result.totalProcessed,
          startedAtMs: result.startedAtMs,
          completedAtMs: result.completedAtMs,
        });

        // Batch Compress child jobs will be pushed via queue event stream (`transcoding://queue-state`).
        // This function only records batch metadata and returns immediately.
        queueError.value = null;
        return;
      } catch (error) {
        console.error("auto-compress failed with root path", error);
        queueError.value = t?.("queue.error.autoCompressFailed") ?? "";
      }
    } else {
      // 没有路径时显示错误
      queueError.value = t?.("batchCompress.noPathSelected") ?? "Please select a folder to scan";
      return;
    }

    // Fallback to mock behavior when backend path fails.
    runBatchCompressMock(config);
  };

  const startBatchCompress = async () => {
    activeTab.value = "queue";

    // 如果有之前拖拽的路径，预填充到配置中
    if (lastDroppedRoot.value) {
      smartConfig.value.rootPath = lastDroppedRoot.value;
    }

    // 直接打开批量压缩面板，让用户在面板内选择路径和配置
    showBatchCompress.value = true;
  };

  return {
    // State
    smartConfig,
    showBatchCompress,
    batchCompressBatchMeta,
    expandedBatchIds,

    // Computed
    compositeBatchCompressTasks,
    compositeTasksById,
    hasBatchCompressBatches,

    // Methods
    applyBatchCompressBatchMetaSnapshot,
    runBatchCompressMock,
    runBatchCompress,
    startBatchCompress,
  };
}

export default useBatchCompress;
