import { computed, ref, type Ref, type ComputedRef } from "vue";
import type {
  TranscodeJob,
  SmartScanConfig,
  CompositeSmartScanTask,
  JobStatus,
  FFmpegPreset,
} from "@/types";
import { DEFAULT_SMART_SCAN_CONFIG, EXTENSIONS } from "@/constants";
import { hasTauri, runAutoCompress } from "@/lib/backend";

// ----- Types -----

export interface SmartScanBatchMeta {
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

export interface SmartScanBatchSnapshot {
  batchId: string;
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

// ----- Composable -----

export interface UseSmartScanOptions {
  /** The list of jobs. */
  jobs: Ref<TranscodeJob[]>;
  /** Smart scan jobs ref. */
  smartScanJobs: Ref<TranscodeJob[]>;
  /** Available presets. */
  presets: Ref<FFmpegPreset[]>;
  /** Queue error ref. */
  queueError: Ref<string | null>;
  /** Last dropped root path. */
  lastDroppedRoot: Ref<string | null>;
  /** Active tab ref. */
  activeTab: Ref<string>;
  /** Optional i18n translation function. */
  t?: (key: string) => string;
}

export interface UseSmartScanReturn {
  // ----- State -----
  /** Smart scan configuration. */
  smartConfig: Ref<SmartScanConfig>;
  /** Whether smart scan dialog is visible. */
  showSmartScan: Ref<boolean>;
  /** Smart scan batch metadata by batch ID. */
  smartScanBatchMeta: Ref<Record<string, SmartScanBatchMeta>>;
  /** Expanded batch IDs (for accordion UI). */
  expandedBatchIds: Ref<Set<string>>;

  // ----- Computed -----
  /** Composite smart scan tasks for display. */
  compositeSmartScanTasks: ComputedRef<CompositeSmartScanTask[]>;
  /** Map of batch ID to composite task. */
  compositeTasksById: ComputedRef<Map<string, CompositeSmartScanTask>>;
  /** Whether there are any smart scan batches. */
  hasSmartScanBatches: ComputedRef<boolean>;

  // ----- Methods -----
  /** Apply batch metadata snapshot from backend. */
  applySmartScanBatchMetaSnapshot: (snapshot: SmartScanBatchSnapshot) => void;
  /** Run smart scan (mock for non-Tauri). */
  runSmartScanMock: (config: SmartScanConfig) => void;
  /** Run smart scan (real). */
  runSmartScan: (config: SmartScanConfig) => Promise<void>;
  /** Start smart scan (open dialog or wizard). */
  startSmartScan: () => Promise<void>;
}

/**
 * Composable for smart scan (auto-compress) functionality.
 */
export function useSmartScan(options: UseSmartScanOptions): UseSmartScanReturn {
  const {
    jobs,
    // smartScanJobs and presets are provided for future use but not currently needed
    queueError,
    lastDroppedRoot,
    activeTab,
    t,
  } = options;

  // ----- State -----
  const smartConfig = ref<SmartScanConfig>({ ...DEFAULT_SMART_SCAN_CONFIG });
  const showSmartScan = ref(false);
  const smartScanBatchMeta = ref<Record<string, SmartScanBatchMeta>>({});
  const expandedBatchIds = ref<Set<string>>(new Set());

  // ----- Batch Meta Methods -----
  const applySmartScanBatchMetaSnapshot = (snapshot: SmartScanBatchSnapshot) => {
    const prev = smartScanBatchMeta.value[snapshot.batchId];

    const next: SmartScanBatchMeta = {
      rootPath: snapshot.rootPath || prev?.rootPath || "",
      totalFilesScanned: Math.max(
        prev?.totalFilesScanned ?? 0,
        snapshot.totalFilesScanned,
      ),
      totalCandidates: Math.max(
        prev?.totalCandidates ?? 0,
        snapshot.totalCandidates,
      ),
      totalProcessed: Math.max(
        prev?.totalProcessed ?? 0,
        snapshot.totalProcessed,
      ),
      startedAtMs: prev?.startedAtMs ?? snapshot.startedAtMs,
      completedAtMs: snapshot.completedAtMs ?? prev?.completedAtMs,
    };

    smartScanBatchMeta.value = {
      ...smartScanBatchMeta.value,
      [snapshot.batchId]: next,
    };
  };

  // ----- Computed -----
  const compositeSmartScanTasks = computed<CompositeSmartScanTask[]>(() => {
    const byBatch: Record<string, { jobs: TranscodeJob[] }> = {};

    for (const job of jobs.value) {
      const batchId = job.batchId;
      if (!batchId) continue;
      if (!byBatch[batchId]) {
        byBatch[batchId] = { jobs: [] };
      }
      byBatch[batchId].jobs.push(job);
    }

    const metaById = smartScanBatchMeta.value;
    const allBatchIds = new Set<string>([
      ...Object.keys(metaById),
      ...Object.keys(byBatch),
    ]);

    const tasks: CompositeSmartScanTask[] = [];

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
            if (
              !currentJob ||
              (job.startTime ?? 0) > (currentJob.startTime ?? 0)
            ) {
              currentJob = job;
            }
            break;
          default:
            break;
        }
      }

      const locallyProcessedCount =
        completedCount + skippedCount + failedCount + cancelledCount;

      const totalCandidates = meta?.totalCandidates ?? totalCount;
      const totalProcessed = meta?.totalProcessed ?? locallyProcessedCount;

      const hasQueuedChildren = batchJobs.length > 0;
      const batchComplete =
        totalCandidates > 0 && totalProcessed >= totalCandidates;

      if (!hasQueuedChildren && batchComplete) {
        // 当该批次的所有子任务都已经处理完并且从队列中移除时，不再渲染空的复合任务卡片，
        // 这样“从列表中删除”在包含智能压缩批次时也能真正清空队列视图。
        // （Smart Scan 元数据仍保留在前端状态中，用于后续统计或调试。）
        // 这里仅在 totalCandidates > 0 的情况下隐藏，避免影响纯扫描但无候选的边界情况。
        // 这也避免了仅靠批次元数据就让队列面板看起来“还有任务没删干净”的错觉。
        continue;
      }

      const overallProgress =
        totalCount > 0 ? (progressSum / totalCount) * 100 : 0;

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

  const hasSmartScanBatches = computed(() => {
    return Object.keys(smartScanBatchMeta.value).length > 0;
  });

  const compositeTasksById = computed(() => {
    const map = new Map<string, CompositeSmartScanTask>();
    for (const task of compositeSmartScanTasks.value) {
      map.set(task.batchId, task);
    }
    return map;
  });

  // ----- Scan Methods -----
  const runSmartScanMock = (config: SmartScanConfig) => {
    smartConfig.value = { ...config };
    showSmartScan.value = false;
    activeTab.value = "queue";

    const found: TranscodeJob[] = [];
    const count = 5 + Math.floor(Math.random() * 5);
    const batchId = `mock-batch-${Date.now().toString(36)}`;

    for (let i = 0; i < count; i += 1) {
      const isVideo = Math.random() > 0.4;
      let filename = "";
      let size = 0;
      let codec = "";
      let status: JobStatus = "waiting";
      let skipReason = "";

      if (isVideo) {
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
      } else {
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
      }

      found.push({
        id: `${Date.now().toString()}-${i}`,
        filename,
        type: isVideo ? "video" : "image",
        source: "smart_scan",
        originalSizeMB: size,
        originalCodec: codec,
        presetId: config.videoPresetId,
        status,
        progress: 0,
        logs: [],
        skipReason,
        batchId,
      });
    }

    smartScanBatchMeta.value = {
      ...smartScanBatchMeta.value,
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

  const runSmartScan = async (config: SmartScanConfig) => {
    smartConfig.value = { ...config };
    showSmartScan.value = false;
    activeTab.value = "queue";

    if (!hasTauri()) {
      runSmartScanMock(config);
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

        applySmartScanBatchMetaSnapshot({
          batchId,
          rootPath: result.rootPath,
          totalFilesScanned: result.totalFilesScanned,
          totalCandidates: result.totalCandidates,
          totalProcessed: result.totalProcessed,
          startedAtMs: result.startedAtMs,
          completedAtMs: result.completedAtMs,
        });

        // Smart Scan child jobs will be pushed via queue event stream (`transcoding://queue-state`).
        // This function only records batch metadata and returns immediately.
        queueError.value = null;
        return;
      } catch (error) {
        console.error("auto-compress failed with root path", error);
        queueError.value = (t?.("queue.error.autoCompressFailed") as string) ?? "";
      }
    } else {
      // 没有路径时显示错误
      queueError.value = (t?.("smartScan.noPathSelected") as string) ?? "Please select a folder to scan";
      return;
    }

    // Fallback to mock behavior when backend path fails.
    runSmartScanMock(config);
  };

  const startSmartScan = async () => {
    activeTab.value = "queue";

    // 如果有之前拖拽的路径，预填充到配置中
    if (lastDroppedRoot.value) {
      smartConfig.value.rootPath = lastDroppedRoot.value;
    }

    // 直接打开智能压缩面板，让用户在面板内选择路径和配置
    showSmartScan.value = true;
  };

  return {
    // State
    smartConfig,
    showSmartScan,
    smartScanBatchMeta,
    expandedBatchIds,

    // Computed
    compositeSmartScanTasks,
    compositeTasksById,
    hasSmartScanBatches,

    // Methods
    applySmartScanBatchMetaSnapshot,
    runSmartScanMock,
    runSmartScan,
    startSmartScan,
  };
}

export default useSmartScan;
