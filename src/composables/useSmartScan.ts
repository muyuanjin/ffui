import { computed, ref, type Ref, type ComputedRef } from "vue";
import type {
  TranscodeJob,
  SmartScanConfig,
  CompositeSmartScanTask,
  JobStatus,
  JobType,
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
    if (!snapshot.batchId) return;

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

    if (!prev && !expandedBatchIds.value.has(snapshot.batchId)) {
      const expanded = new Set(expandedBatchIds.value);
      expanded.add(snapshot.batchId);
      expandedBatchIds.value = expanded;
    }
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
        // 有候选时：processed 覆盖所有候选视为完成
        (totalCandidates > 0 && totalProcessed >= totalCandidates) ||
        // 无候选时：仅依据 completedAtMs 是否存在来判断是否“空批次已跑完”
        (totalCandidates === 0 && !!meta?.completedAtMs);

      if (!hasQueuedChildren && batchComplete) {
        // 当该批次的所有子任务都已经处理完并且从队列中移除，或者这是一个“空候选但已完成”的批次时，
        // 不再渲染空的复合任务卡片，避免队列中出现无法选中/删除的“空压缩任务”。
        // Smart Scan 元数据仍保留在前端状态中，用于后续统计或调试。
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

    const enabledKinds: JobType[] = [];
    if (config.videoFilter.enabled) enabledKinds.push("video");
    if (config.imageFilter.enabled) enabledKinds.push("image");
    if (config.audioFilter.enabled) enabledKinds.push("audio");
    const kinds: JobType[] =
      enabledKinds.length > 0 ? enabledKinds : (["video", "image"] as JobType[]);

    for (let i = 0; i < count; i += 1) {
      const kind: JobType = kinds[Math.floor(Math.random() * kinds.length)];
      let filename = "";
      let size = 0;
      let codec = "";
      let status: JobStatus = "waiting";
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

      const presetIdForKind =
        kind === "audio"
          ? config.audioPresetId || ""
          : config.videoPresetId;

      found.push({
        id: `${Date.now().toString()}-${i}`,
        filename,
        type: kind,
        source: "smart_scan",
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

    // 直接打开批量压缩面板，让用户在面板内选择路径和配置
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
