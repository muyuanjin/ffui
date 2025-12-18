import { computed, onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AutoCompressProgress, FFmpegPreset, BatchCompressConfig, TranscodeJob } from "@/types";
import { hasTauri } from "@/lib/backend";
import { useBatchCompress, type UseBatchCompressReturn } from "@/composables";
import type { MainAppTab } from "./useMainAppShell";
import type { Ref, ComputedRef } from "vue";

interface BatchCompressDialogManager {
  openBatchCompress: () => void;
  closeBatchCompress: () => void;
}

export interface UseMainAppBatchCompressOptions {
  t: (key: string) => string;
  activeTab: Ref<MainAppTab>;
  jobs: Ref<TranscodeJob[]>;
  presets: Ref<FFmpegPreset[]>;
  queueError: Ref<string | null>;
  lastDroppedRoot: Ref<string | null>;
  dialogManager: BatchCompressDialogManager;
}

export interface UseMainAppBatchCompressReturn {
  smartConfig: UseBatchCompressReturn["smartConfig"];
  showBatchCompress: UseBatchCompressReturn["showBatchCompress"];
  batchCompressBatchMeta: UseBatchCompressReturn["batchCompressBatchMeta"];
  expandedBatchIds: UseBatchCompressReturn["expandedBatchIds"];
  compositeBatchCompressTasks: UseBatchCompressReturn["compositeBatchCompressTasks"];
  compositeTasksById: UseBatchCompressReturn["compositeTasksById"];
  hasBatchCompressBatches: UseBatchCompressReturn["hasBatchCompressBatches"];
  applyBatchCompressBatchMetaSnapshot: UseBatchCompressReturn["applyBatchCompressBatchMetaSnapshot"];
  batchCompressJobs: ComputedRef<TranscodeJob[]>;
  startBatchCompress: () => Promise<void>;
  runBatchCompress: (config: BatchCompressConfig) => Promise<void>;
  closeBatchCompressWizard: () => void;
  toggleBatchExpanded: (batchId: string) => void;
}

/**
 * Batch Compress (auto-compress) wiring for MainApp.
 *
 * Wraps the shared useBatchCompress composable and connects it to:
 * - MainApp jobs & presets
 * - dialog manager (wizard visibility)
 * - auto-compress progress events from Tauri
 */
export function useMainAppBatchCompress(options: UseMainAppBatchCompressOptions): UseMainAppBatchCompressReturn {
  const { t, activeTab, jobs, presets, queueError, lastDroppedRoot, dialogManager } = options;

  const batchCompressJobs = computed<TranscodeJob[]>(() => jobs.value.filter((job) => job.source === "batch_compress"));

  const {
    smartConfig,
    showBatchCompress,
    batchCompressBatchMeta,
    expandedBatchIds,
    compositeBatchCompressTasks,
    compositeTasksById,
    hasBatchCompressBatches,
    applyBatchCompressBatchMetaSnapshot,
    runBatchCompress: runBatchCompressInner,
    startBatchCompress: startBatchCompressInner,
  } = useBatchCompress({
    jobs,
    batchCompressJobs,
    presets,
    queueError,
    lastDroppedRoot,
    activeTab,
    t: (key: string) => t(key),
  });

  // Public Batch Compress API exposed on the component instance and used by tests.

  const startBatchCompress = async () => {
    await startBatchCompressInner();
    if (showBatchCompress.value) {
      dialogManager.openBatchCompress();
    }
  };

  const runBatchCompress = async (config: BatchCompressConfig) => {
    dialogManager.closeBatchCompress();
    showBatchCompress.value = false;

    if (!hasTauri()) return;

    await runBatchCompressInner(config);
  };

  const closeBatchCompressWizard = () => {
    showBatchCompress.value = false;
    dialogManager.closeBatchCompress();
  };

  const toggleBatchExpanded = (batchId: string) => {
    const next = new Set(expandedBatchIds.value);
    if (next.has(batchId)) {
      next.delete(batchId);
    } else {
      next.add(batchId);
    }
    expandedBatchIds.value = next;
  };

  let batchCompressProgressUnlisten: UnlistenFn | null = null;

  // Wire auto-compress progress events from backend into Batch Compress batch meta.
  onMounted(() => {
    if (!hasTauri()) return;

    void listen<AutoCompressProgress>("auto-compress://progress", (event) => {
      const { batchId, totalFilesScanned, totalCandidates, totalProcessed, rootPath, completedAtMs } = event.payload;
      if (!batchId) return;

      applyBatchCompressBatchMetaSnapshot({
        batchId,
        rootPath: rootPath ?? "",
        totalFilesScanned: totalFilesScanned ?? 0,
        totalCandidates: totalCandidates ?? 0,
        totalProcessed: totalProcessed ?? 0,
        completedAtMs: completedAtMs ?? undefined,
      });
    })
      .then((unlisten) => {
        batchCompressProgressUnlisten = unlisten;
      })
      .catch((err) => {
        console.error("Failed to register batch compress progress listener:", err);
      });
  });

  onUnmounted(() => {
    if (batchCompressProgressUnlisten) {
      try {
        batchCompressProgressUnlisten();
      } catch (err) {
        console.error("Failed to unlisten batch compress progress event:", err);
      } finally {
        batchCompressProgressUnlisten = null;
      }
    }
  });

  // Expose Batch Compress batch metadata on the instance for tests.
  void batchCompressBatchMeta;

  return {
    smartConfig,
    showBatchCompress,
    batchCompressBatchMeta,
    expandedBatchIds,
    compositeBatchCompressTasks,
    compositeTasksById,
    hasBatchCompressBatches,
    applyBatchCompressBatchMetaSnapshot,
    batchCompressJobs,
    startBatchCompress,
    runBatchCompress,
    closeBatchCompressWizard,
    toggleBatchExpanded,
  };
}

export default useMainAppBatchCompress;
