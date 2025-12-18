import { ref, watch, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import type { SmartScanBatchMeta } from "@/composables/useSmartScan";
import { hasTauri } from "@/lib/backend";

export interface UseSmartScanQueueRefreshOptions {
  smartScanBatchMeta: Ref<Record<string, SmartScanBatchMeta>>;
  jobs: Ref<TranscodeJob[]>;
  refreshQueueFromBackend: () => Promise<void>;
}

// Smart Scan 运行期间，后台可能已生成子任务但队列事件尚未推送，导致前端“批次存在但列表为空”。
// 当进度快照显示 totalCandidates 超过当前已知子任务数时，触发一次轻量队列刷新以提前拉取任务列表。
export function useSmartScanQueueRefresh(options: UseSmartScanQueueRefreshOptions) {
  const { smartScanBatchMeta, jobs, refreshQueueFromBackend } = options;

  const lastSmartScanQueueRefreshAtMs = ref(0);
  const SMART_SCAN_QUEUE_REFRESH_MIN_INTERVAL_MS = 1000;

  watch(
    [smartScanBatchMeta, jobs],
    async () => {
      if (!hasTauri()) return;

      const metaById = smartScanBatchMeta.value;
      const batchIds = Object.keys(metaById);
      if (batchIds.length === 0) return;

      const jobCountByBatch = new Map<string, number>();
      for (const job of jobs.value) {
        const batchId = job.batchId;
        if (!batchId) continue;
        jobCountByBatch.set(batchId, (jobCountByBatch.get(batchId) ?? 0) + 1);
      }

      let shouldRefresh = false;
      for (const batchId of batchIds) {
        const meta = metaById[batchId];
        if (!meta) continue;

        // 仅在批次已产生候选/处理推进但前端子任务仍不足时刷新，避免无谓请求。
        const totalCandidates = meta.totalCandidates ?? 0;
        const totalProcessed = meta.totalProcessed ?? 0;
        if (totalCandidates <= 0 && totalProcessed <= 0) continue;

        const currentCount = jobCountByBatch.get(batchId) ?? 0;
        if (currentCount < totalCandidates) {
          shouldRefresh = true;
          break;
        }
      }

      if (!shouldRefresh) return;

      const now = Date.now();
      if (
        lastSmartScanQueueRefreshAtMs.value &&
        now - lastSmartScanQueueRefreshAtMs.value < SMART_SCAN_QUEUE_REFRESH_MIN_INTERVAL_MS
      ) {
        return;
      }

      lastSmartScanQueueRefreshAtMs.value = now;

      try {
        await refreshQueueFromBackend();
      } catch (error) {
        console.error("Failed to refresh queue state after Smart Scan progress", error);
      }
    },
    { flush: "post" },
  );
}

export default useSmartScanQueueRefresh;
