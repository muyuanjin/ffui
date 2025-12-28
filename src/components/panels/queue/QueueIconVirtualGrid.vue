<script setup lang="ts">
import { computed, defineAsyncComponent, onScopeDispose, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import { VList } from "virtua/vue";
import type { CompositeBatchCompressTask, QueueProgressStyle, TranscodeJob } from "@/types";
import type { QueueListItem } from "@/composables";
import { useVirtuaViewportBump } from "@/components/panels/queue/useVirtuaViewportBump";
import { buildIconGridRows, computeIconGridColumns, getIconGridMinColumnWidthPx } from "./iconGridVirtualization";
import { useQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { createQueuePreviewPrefetcher } from "@/components/queue-item/previewPrefetcher";
import { createQueuePreviewEnsurePrefetcher } from "@/components/queue-item/previewEnsurePrefetcher";

const QueueIconItem = defineAsyncComponent(() => import("@/components/QueueIconItem.vue"));
const QueueBatchCompressIconBatchItem = defineAsyncComponent(
  () => import("@/components/QueueBatchCompressIconBatchItem.vue"),
);

const props = defineProps<{
  items: QueueListItem[];
  iconViewSize: "small" | "medium" | "large";
  queueProgressStyle: QueueProgressStyle;
  pausingJobIds: Set<string>;
  selectedJobIds: Set<string>;
  isBatchFullySelected: (batch: CompositeBatchCompressTask) => boolean;
}>();

const emit = defineEmits<{
  (e: "toggleJobSelected", jobId: string): void;
  (e: "inspectJob", job: TranscodeJob): void;
  (e: "previewJob", job: TranscodeJob): void;
  (e: "compareJob", job: TranscodeJob): void;
  (e: "openJobContextMenu", payload: { job: TranscodeJob; event: MouseEvent }): void;
  (e: "openBatchDetail", batch: CompositeBatchCompressTask): void;
  (e: "toggleBatchSelection", batch: CompositeBatchCompressTask): void;
  (e: "contextmenuBatch", payload: { batch: CompositeBatchCompressTask; event: MouseEvent }): void;
}>();

const viewportEl = ref<HTMLElement | null>(null);
const viewportBump = useVirtuaViewportBump(viewportEl, { minHeightPx: 64 });
const { width: viewportWidth, height: viewportHeight } = useElementSize(viewportEl);

const viewportHeightPx = computed(() => Math.max(1, Math.floor(viewportHeight.value)));

const columns = computed(() => computeIconGridColumns(viewportWidth.value, props.iconViewSize));

const gridTemplateColumns = computed(() => {
  const minWidth = getIconGridMinColumnWidthPx(props.iconViewSize);
  const cols = columns.value;
  return `repeat(${cols}, minmax(${minWidth}px, 1fr))`;
});

const rows = computed(() => buildIconGridRows(props.items, columns.value));

const virtualListKey = computed(() => {
  return `cols=${columns.value}|items=${props.items.length}|layout=${viewportBump.value}`;
});

const virtualListItemSizePx = computed(() => {
  // Fixed-size hint keeps Virtua stable on first paint; rows still get measured.
  if (props.iconViewSize === "large") return 320;
  if (props.iconViewSize === "medium") return 280;
  return 250;
});

const virtualListBufferSizePx = computed(() => {
  // Bigger cards => fewer rows in viewport; slightly larger buffer avoids blanks
  // on trackpad scrolling without pushing too many DOM nodes.
  if (props.iconViewSize === "large") return 800;
  return 600;
});

const perfHints = useQueuePerfHints();
const iconScrollOffset = ref(0);
const iconVListRef = ref<any>(null);
const iconPrefetcher = createQueuePreviewPrefetcher();
const iconEnsurePrefetcher = createQueuePreviewEnsurePrefetcher();
onScopeDispose(() => {
  iconPrefetcher.clear();
  iconEnsurePrefetcher.clear();
});

const updateIconPrefetchTargets = () => {
  const handleOffset = iconVListRef.value?.scrollOffset;
  if (typeof handleOffset === "number" && Number.isFinite(handleOffset)) {
    iconScrollOffset.value = Math.max(0, Math.floor(handleOffset));
  }
  if (perfHints?.isScrolling.value) {
    iconPrefetcher.clear();
    iconEnsurePrefetcher.clear();
    return;
  }
  const itemSize = Math.max(1, virtualListItemSizePx.value);
  const viewportRows = Math.max(1, Math.ceil(viewportHeightPx.value / itemSize));
  const overscanRows = Math.max(1, Math.ceil(virtualListBufferSizePx.value / itemSize));
  const startRow = Math.floor(iconScrollOffset.value / itemSize) - overscanRows;
  const endRow = startRow + viewportRows + overscanRows * 2;

  const picked: TranscodeJob[] = [];
  const gridRows = rows.value;
  const start = Math.max(0, Math.floor(startRow));
  const end = Math.min(gridRows.length, Math.max(start, Math.floor(endRow)));
  for (let i = start; i < end; i += 1) {
    const r = gridRows[i];
    if (!r) continue;
    for (const item of r.items) {
      if (item.kind === "job") picked.push(item.job);
    }
  }
  iconPrefetcher.setTargetJobs(picked);
  iconEnsurePrefetcher.setTargetJobs(picked);
};

const onIconScroll = (offset: number) => {
  iconScrollOffset.value = Math.max(0, Math.floor(offset));
  updateIconPrefetchTargets();
};

watch(
  () => perfHints?.isScrolling.value,
  () => updateIconPrefetchTargets(),
  { flush: "post" },
);
watch([rows, viewportHeightPx, virtualListItemSizePx, virtualListBufferSizePx], () => updateIconPrefetchTargets(), {
  flush: "post",
});
</script>

<template>
  <div
    ref="viewportEl"
    class="flex-1 min-h-0 overflow-hidden"
    data-testid="queue-icon-grid"
    data-queue-icon-grid-virtual="1"
  >
    <VList
      ref="iconVListRef"
      :key="virtualListKey"
      v-slot="{ item: row }"
      :data="rows"
      :buffer-size="virtualListBufferSizePx"
      :item-size="virtualListItemSizePx"
      class="flex-1 min-h-0"
      :style="{ height: `${viewportHeightPx}px` }"
      @scroll="onIconScroll"
      @scroll-end="updateIconPrefetchTargets"
    >
      <div :key="`row:${row.index}`" class="pb-3">
        <div class="grid gap-3" :style="{ gridTemplateColumns }">
          <template
            v-for="item in row.items"
            :key="item.kind === 'job' ? `job:${item.job.id}` : `batch:${item.batch.batchId}`"
          >
            <QueueIconItem
              v-if="item.kind === 'job'"
              :job="item.job"
              :is-pausing="pausingJobIds.has(item.job.id)"
              :size="iconViewSize"
              :progress-style="queueProgressStyle"
              :can-select="true"
              :selected="selectedJobIds.has(item.job.id)"
              @toggle-select="emit('toggleJobSelected', $event)"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
              @compare="emit('compareJob', $event)"
              @contextmenu-job="emit('openJobContextMenu', $event)"
            />
            <QueueBatchCompressIconBatchItem
              v-else
              :batch="item.batch"
              :size="iconViewSize"
              :progress-style="queueProgressStyle"
              :can-select="true"
              :selected="isBatchFullySelected(item.batch)"
              @open-detail="emit('openBatchDetail', $event)"
              @toggle-select="emit('toggleBatchSelection', item.batch)"
              @contextmenu-batch="(payload) => emit('contextmenuBatch', { batch: item.batch, event: payload.event })"
            />
          </template>
        </div>
      </div>
    </VList>
  </div>
</template>
