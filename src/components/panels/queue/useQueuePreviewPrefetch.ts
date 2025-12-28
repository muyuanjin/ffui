import { onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import type { QueueVirtualRow } from "@/components/panels/useQueuePanelVirtualRows";
import { createQueuePreviewPrefetcher } from "@/components/queue-item/previewPrefetcher";

const pickJobsForPrefetch = (
  rows: readonly QueueVirtualRow[],
  startIndex: number,
  endIndex: number,
): TranscodeJob[] => {
  const jobs: TranscodeJob[] = [];
  const start = Math.max(0, Math.floor(startIndex));
  const end = Math.min(rows.length, Math.max(start, Math.floor(endIndex)));
  for (let i = start; i < end; i += 1) {
    const row = rows[i];
    if (!row || row.type === "header") continue;
    if (row.type === "processingJob") {
      jobs.push(row.job);
      continue;
    }
    const item = row.item;
    if (item?.kind === "job") jobs.push(item.job);
  }
  return jobs;
};

export function useQueuePreviewPrefetch(options: {
  isScrolling: Ref<boolean>;
  rows: ComputedRef<QueueVirtualRow[]>;
  viewportHeightPx: ComputedRef<number>;
  itemSizePx: ComputedRef<number>;
  bufferSizePx: ComputedRef<number>;
}): {
  vlistRef: Ref<any>;
  onScroll: (offset: number) => void;
  onScrollEnd: () => void;
} {
  const scrollOffset = ref(0);
  const vlistRef = ref<any>(null);
  const prefetcher = createQueuePreviewPrefetcher();
  onScopeDispose(() => prefetcher.clear());

  const updateTargets = () => {
    const handleOffset = vlistRef.value?.scrollOffset;
    if (typeof handleOffset === "number" && Number.isFinite(handleOffset)) {
      scrollOffset.value = Math.max(0, Math.floor(handleOffset));
    }

    if (options.isScrolling.value) {
      prefetcher.clear();
      return;
    }

    const itemSize = Math.max(1, options.itemSizePx.value);
    const viewportItems = Math.max(1, Math.ceil(options.viewportHeightPx.value / itemSize));
    const overscanItems = Math.max(2, Math.ceil(options.bufferSizePx.value / itemSize));
    const start = Math.floor(scrollOffset.value / itemSize) - overscanItems;
    const end = start + viewportItems + overscanItems * 2;

    prefetcher.setTargetJobs(pickJobsForPrefetch(options.rows.value, start, end));
  };

  const onScroll = (offset: number) => {
    scrollOffset.value = Math.max(0, Math.floor(offset));
    updateTargets();
  };

  const onScrollEnd = () => updateTargets();

  watch(options.isScrolling, () => updateTargets(), { flush: "post" });
  watch([options.rows, options.viewportHeightPx, options.itemSizePx, options.bufferSizePx], () => updateTargets(), {
    flush: "post",
  });

  return { vlistRef, onScroll, onScrollEnd };
}
