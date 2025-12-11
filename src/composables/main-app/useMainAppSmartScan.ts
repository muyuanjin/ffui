import { computed, onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AutoCompressProgress, FFmpegPreset, SmartScanConfig, TranscodeJob } from "@/types";
import { hasTauri } from "@/lib/backend";
import { useSmartScan, type UseSmartScanReturn } from "@/composables";
import type { MainAppTab } from "./useMainAppShell";
import type { Ref, ComputedRef } from "vue";

interface SmartScanDialogManager {
  openSmartScan: () => void;
  closeSmartScan: () => void;
}

export interface UseMainAppSmartScanOptions {
  t: (key: string) => string;
  activeTab: Ref<MainAppTab>;
  jobs: Ref<TranscodeJob[]>;
  presets: Ref<FFmpegPreset[]>;
  queueError: Ref<string | null>;
  lastDroppedRoot: Ref<string | null>;
  dialogManager: SmartScanDialogManager;
}

export interface UseMainAppSmartScanReturn {
  smartConfig: UseSmartScanReturn["smartConfig"];
  showSmartScan: UseSmartScanReturn["showSmartScan"];
  smartScanBatchMeta: UseSmartScanReturn["smartScanBatchMeta"];
  expandedBatchIds: UseSmartScanReturn["expandedBatchIds"];
  compositeSmartScanTasks: UseSmartScanReturn["compositeSmartScanTasks"];
  compositeTasksById: UseSmartScanReturn["compositeTasksById"];
  hasSmartScanBatches: UseSmartScanReturn["hasSmartScanBatches"];
  applySmartScanBatchMetaSnapshot: UseSmartScanReturn["applySmartScanBatchMetaSnapshot"];
  smartScanJobs: ComputedRef<TranscodeJob[]>;
  startSmartScan: () => Promise<void>;
  runSmartScan: (config: SmartScanConfig) => Promise<void>;
  closeSmartScanWizard: () => void;
  toggleBatchExpanded: (batchId: string) => void;
}

/**
 * Smart Scan (auto-compress) wiring for MainApp.
 *
 * Wraps the shared useSmartScan composable and connects it to:
 * - MainApp jobs & presets
 * - dialog manager (wizard visibility)
 * - auto-compress progress events from Tauri
 */
export function useMainAppSmartScan(options: UseMainAppSmartScanOptions): UseMainAppSmartScanReturn {
  const { t, activeTab, jobs, presets, queueError, lastDroppedRoot, dialogManager } = options;

  const smartScanJobs = computed<TranscodeJob[]>(() =>
    jobs.value.filter((job) => job.source === "smart_scan"),
  );

  const {
    smartConfig,
    showSmartScan,
    smartScanBatchMeta,
    expandedBatchIds,
    compositeSmartScanTasks,
    compositeTasksById,
    hasSmartScanBatches,
    applySmartScanBatchMetaSnapshot,
    runSmartScan: runSmartScanInner,
    startSmartScan: startSmartScanInner,
  } = useSmartScan({
    jobs,
    smartScanJobs,
    presets,
    queueError,
    lastDroppedRoot,
    activeTab,
    t: (key: string) => t(key),
  });

  // Public Smart Scan API exposed on the component instance and used by tests.

  const startSmartScan = async () => {
    await startSmartScanInner();
    if (showSmartScan.value) {
      dialogManager.openSmartScan();
    }
  };

  const runSmartScan = async (config: SmartScanConfig) => {
    dialogManager.closeSmartScan();
    showSmartScan.value = false;

    if (!hasTauri()) return;

    await runSmartScanInner(config);
  };

  const closeSmartScanWizard = () => {
    showSmartScan.value = false;
    dialogManager.closeSmartScan();
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

  let smartScanProgressUnlisten: UnlistenFn | null = null;

  // Wire auto-compress progress events from backend into Smart Scan batch meta.
  onMounted(() => {
    if (!hasTauri()) return;

    void listen<AutoCompressProgress>("auto-compress://progress", (event) => {
      const {
        batchId,
        totalFilesScanned,
        totalCandidates,
        totalProcessed,
        rootPath,
        completedAtMs,
      } = event.payload;
      if (!batchId) return;

      applySmartScanBatchMetaSnapshot({
        batchId,
        rootPath: rootPath ?? "",
        totalFilesScanned: totalFilesScanned ?? 0,
        totalCandidates: totalCandidates ?? 0,
        totalProcessed: totalProcessed ?? 0,
        completedAtMs: completedAtMs ?? undefined,
      });
    })
      .then((unlisten) => {
        smartScanProgressUnlisten = unlisten;
      })
      .catch((err) => {
        console.error("Failed to register smart scan progress listener:", err);
      });
  });

  onUnmounted(() => {
    if (smartScanProgressUnlisten) {
      try {
        smartScanProgressUnlisten();
      } catch (err) {
        console.error("Failed to unlisten smart scan progress event:", err);
      } finally {
        smartScanProgressUnlisten = null;
      }
    }
  });

  // Expose Smart Scan batch metadata on the instance for tests.
  void smartScanBatchMeta;

  return {
    smartConfig,
    showSmartScan,
    smartScanBatchMeta,
    expandedBatchIds,
    compositeSmartScanTasks,
    compositeTasksById,
    hasSmartScanBatches,
    applySmartScanBatchMetaSnapshot,
    smartScanJobs,
    startSmartScan,
    runSmartScan,
    closeSmartScanWizard,
    toggleBatchExpanded,
  };
}

export default useMainAppSmartScan;
