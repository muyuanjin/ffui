import { computed } from "vue";
import { isQueuePerfEnabled, recordQueuePanelVirtualRowsBuild } from "@/lib/queuePerf";
import type { TranscodeJob } from "@/types";
import type { QueueListItem } from "@/composables";

const TERMINAL_STATUSES_FOR_QUEUE_MODE = new Set<TranscodeJob["status"]>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

export type QueueVirtualRow =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "processingJob"; key: string; job: TranscodeJob }
  | { type: "waitingItem"; key: string; item: QueueListItem }
  | { type: "restItem"; key: string; item: QueueListItem }
  | { type: "displayItem"; key: string; item: QueueListItem };

export interface QueuePanelVirtualRowsSnapshot {
  queueMode: "queue" | "display";
  queueRowVariant: "detail" | "compact" | "mini";
  queueViewMode: string;
  visibleQueueItems: QueueListItem[];
  queueModeProcessingJobs: TranscodeJob[];
  queueModeWaitingItems: QueueListItem[];
  queueModeWaitingBatchIds: Set<string>;
}

const perfNow = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const getQueueListItemKey = (item: QueueListItem): string =>
  item.kind === "batch" ? `batch:${item.batch.batchId}` : `job:${item.job.id}`;

const QUEUE_VLIST_ROW_GAP_PX = 8;

export function useQueuePanelVirtualRows(deps: () => QueuePanelVirtualRowsSnapshot, t: (key: string) => string) {
  const getQueueVirtualRowKey = (row: QueueVirtualRow): string => row.key;

  const virtualListItemSizeHint = computed(() => {
    const { queueRowVariant } = deps();
    const rowGapPx = queueRowVariant !== "mini" ? QUEUE_VLIST_ROW_GAP_PX : 0;
    if (queueRowVariant === "mini") return 48;
    if (queueRowVariant === "compact") return 120 + rowGapPx;
    return 180 + rowGapPx;
  });

  const virtualListItemSizePx = computed(() => virtualListItemSizeHint.value);

  const virtualListBufferSizePx = computed(() => Math.min(400, Math.max(200, virtualListItemSizePx.value * 2)));

  const virtualListRows = computed<QueueVirtualRow[]>(() => {
    const snapshot = deps();
    const started = isQueuePerfEnabled ? perfNow() : null;
    if (snapshot.queueMode !== "queue") {
      const rows: QueueVirtualRow[] = snapshot.visibleQueueItems.map((item) => ({
        type: "displayItem" as const,
        key: getQueueListItemKey(item),
        item,
      }));
      if (started != null) {
        recordQueuePanelVirtualRowsBuild(perfNow() - started);
      }
      return rows;
    }

    const rows: QueueVirtualRow[] = [];

    if (snapshot.queueModeProcessingJobs.length > 0) {
      rows.push({
        type: "header",
        key: "group:processing",
        label: t("queue.groups.processing"),
        count: snapshot.queueModeProcessingJobs.length,
      });
      for (const job of snapshot.queueModeProcessingJobs) {
        rows.push({ type: "processingJob", key: `job:${job.id}`, job });
      }
    }

    if (snapshot.queueModeWaitingItems.length > 0) {
      rows.push({
        type: "header",
        key: "group:waiting",
        label: t("queue.groups.waiting"),
        count: snapshot.queueModeWaitingItems.length,
      });
      for (const item of snapshot.queueModeWaitingItems) {
        rows.push({ type: "waitingItem", key: getQueueListItemKey(item), item });
      }
    }

    const restItems: QueueListItem[] = [];
    for (const item of snapshot.visibleQueueItems) {
      if (item.kind === "batch") {
        if (!snapshot.queueModeWaitingBatchIds.has(item.batch.batchId)) {
          restItems.push(item);
        }
        continue;
      }

      if (TERMINAL_STATUSES_FOR_QUEUE_MODE.has(item.job.status)) {
        restItems.push(item);
      }
    }

    if (restItems.length > 0) {
      rows.push({
        type: "header",
        key: "group:completed",
        label: t("queue.groups.completed"),
        count: restItems.length,
      });
      for (const item of restItems) {
        rows.push({ type: "restItem", key: getQueueListItemKey(item), item });
      }
    }

    if (started != null) {
      recordQueuePanelVirtualRowsBuild(perfNow() - started);
    }
    return rows;
  });

  // Virtua's VList measures its viewport height. Under some mount timings the
  // measured height can be temporarily too small, leaving only one row rendered
  // until a remount (e.g. tab switch) occurs. We keep this key stable across
  // normal queue state changes to avoid scroll/DOM flicker; initial measurement
  // recovery is handled by `useVirtuaViewportBump` in QueuePanel.
  const virtualListKey = computed(() => {
    const snapshot = deps();
    return [snapshot.queueMode, snapshot.queueRowVariant, snapshot.queueViewMode].join("|");
  });

  return {
    getQueueVirtualRowKey,
    virtualListRows,
    virtualListBufferSizePx,
    virtualListItemSizePx,
    virtualListKey,
  };
}
