<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import QueueBatchCompressBatchCard from "./QueueBatchCompressBatchCard.vue";
import { useI18n } from "vue-i18n";
import { VList } from "virtua/vue";
import { hasTauri } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import type { TranscodeJob, CompositeBatchCompressTask } from "@/types";
import type { QueuePanelEmits, QueuePanelProps } from "./QueuePanel.types";
import { usePresetLookup } from "@/composables/presets/usePresetLookup";
import { useVirtuaViewportBump } from "@/components/panels/queue/useVirtuaViewportBump";
import { useFlipReorderAnimation } from "@/components/panels/queue/useFlipReorderAnimation";
import QueueIconVirtualGrid from "@/components/panels/queue/QueueIconVirtualGrid.vue";
import { useQueuePanelVirtualRows } from "./useQueuePanelVirtualRows";

// Lazy load queue item components
const QueueItem = defineAsyncComponent(() => import("@/components/QueueItem.vue"));
const QueueCarousel3DView = defineAsyncComponent(() => import("@/components/queue-item/QueueCarousel3DView.vue"));

const props = defineProps<QueuePanelProps>();
const emit = defineEmits<QueuePanelEmits>();

const { t, locale } = useI18n();

const emptyQueueBadgeLines = computed(() => {
  const label = t("app.tabs.queue");
  const currentLocale = String(locale.value ?? "");

  if (currentLocale.startsWith("zh")) {
    // Chinese: prefer a balanced 2+2 split for "任务队列" instead of breaking characters arbitrarily.
    return label.length === 4 ? [label.slice(0, 2), label.slice(2)] : [label];
  }

  // Non-Chinese: prefer word boundaries (e.g. "Transcode" + "Queue").
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 2) return parts;
  if (parts.length > 2) return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
  return [label];
});

const isBatchExpanded = (batchId: string) => props.expandedBatchIds.has(batchId);

const canCancelJob = (job: TranscodeJob): boolean => {
  return hasTauri() && ["queued", "processing", "paused"].includes(job.status);
};

const queueItemListeners = {
  cancel: (jobId: string) => emit("cancelJob", jobId),
  wait: (jobId: string) => emit("waitJob", jobId),
  resume: (jobId: string) => emit("resumeJob", jobId),
  restart: (jobId: string) => emit("restartJob", jobId),
  "toggle-select": (jobId: string) => emit("toggleJobSelected", jobId),
  inspect: (job: TranscodeJob) => emit("inspectJob", job),
  preview: (job: TranscodeJob) => emit("previewJob", job),
  compare: (job: TranscodeJob) => emit("compareJob", job),
  "contextmenu-job": (payload: { job: TranscodeJob; event: MouseEvent }) => emit("openJobContextMenu", payload),
} as const;

const getBatchCardProps = (batch: CompositeBatchCompressTask) => {
  return {
    batch,
    presets: props.presets,
    ffmpegResolvedPath: props.ffmpegResolvedPath ?? null,
    queueRowVariant: props.queueRowVariant,
    queueProgressStyle: props.queueProgressStyle,
    progressUpdateIntervalMs: props.progressUpdateIntervalMs,
    selectedJobIds: props.selectedJobIds,
    isExpanded: isBatchExpanded(batch.batchId),
    canCancelJob,
    sortCompareFn: props.sortCompareFn,
  };
};

const { resolvePresetForJob: getPresetForJob } = usePresetLookup(() => props.presets);

const getBatchCardListeners = (batch: CompositeBatchCompressTask) => {
  return {
    toggleBatchExpanded: (batchId: string) => emit("toggleBatchExpanded", batchId),
    cancelJob: (jobId: string) => emit("cancelJob", jobId),
    waitJob: (jobId: string) => emit("waitJob", jobId),
    resumeJob: (jobId: string) => emit("resumeJob", jobId),
    restartJob: (jobId: string) => emit("restartJob", jobId),
    toggleJobSelected: (jobId: string) => emit("toggleJobSelected", jobId),
    inspectJob: (job: TranscodeJob) => emit("inspectJob", job),
    previewJob: (job: TranscodeJob) => emit("previewJob", job),
    compareJob: (job: TranscodeJob) => emit("compareJob", job),
    openJobContextMenu: (payload: { job: TranscodeJob; event: MouseEvent }) => emit("openJobContextMenu", payload),
    contextmenuBatch: (payload: { batch: CompositeBatchCompressTask; event: MouseEvent }) =>
      handleBatchContextMenu(batch, payload.event),
  };
};

/**
 * 判断一个 Batch Compress 批次是否“完全选中”（所有子任务都在 selectedJobIds 中）。
 * 用于图标视图下的复合卡片选中状态和批量点击行为。
 */
const isBatchFullySelected = (batch: CompositeBatchCompressTask): boolean => {
  const jobs = batch.jobs ?? [];
  if (jobs.length === 0) return false;
  for (const job of jobs) {
    if (!props.selectedJobIds.has(job.id)) {
      return false;
    }
  }
  return true;
};

/**
 * 在图标视图中点击复合任务卡片时的批量选中逻辑：
 * - 如果当前批次所有子任务都已选中，则取消该批次所有子任务的选中；
 * - 否则，仅为该批次中未被选中的子任务补齐选中状态，不影响其它任务的选中。
 */
const handleToggleBatchSelection = (batch: CompositeBatchCompressTask) => {
  const jobs = batch.jobs ?? [];
  if (jobs.length === 0) return;

  const fullySelected = isBatchFullySelected(batch);

  if (fullySelected) {
    // 批次已经处于“全选”状态时，点击视为“取消选中该批次所有子任务”
    for (const job of jobs) {
      if (props.selectedJobIds.has(job.id)) {
        emit("toggleJobSelected", job.id);
      }
    }
  } else {
    // 批次尚未全选时，仅为未选中的子任务补齐选中，避免“逐个取反”导致的半选中困惑
    for (const job of jobs) {
      if (!props.selectedJobIds.has(job.id)) {
        emit("toggleJobSelected", job.id);
      }
    }
  }
};

/**
 * 在图标视图中右键复合任务卡片时的批量操作入口：
 * - 先清空现有选中，再选中该批次所有子任务；
 * - 随后以 bulk 模式打开队列右键菜单，使“删除/暂停/继续/移动”等操作明确作用于该批次。
 */
const handleBatchContextMenu = (batch: CompositeBatchCompressTask, event: MouseEvent) => {
  const jobs = batch.jobs ?? [];

  // 重置选中集为该批次的子任务集合，保持与右键单个任务时的心智一致
  emit("clearSelection");
  for (const job of jobs) {
    emit("toggleJobSelected", job.id);
  }

  emit("openBulkContextMenu", event);
};

// Startup safety net: force a one-time VList remount once the viewport is measurable.
const listViewportEl = ref<HTMLElement | null>(null);
const listViewportBump = useVirtuaViewportBump(listViewportEl);
const { height: listViewportHeight } = useElementSize(listViewportEl);
const listViewportHeightPx = computed(() => Math.max(1, Math.floor(listViewportHeight.value)));
const listDataBump = ref(0);
let listDataBumped = false;
const bumpListDataOnce = () => {
  if (listDataBumped) return;
  if (!listViewportEl.value) return;
  // Only bump once the viewport is measurable; a 1px height is a safe placeholder.
  if (listViewportHeightPx.value <= 1) return;

  listDataBumped = true;
  if (typeof window === "undefined") {
    listDataBump.value = 1;
    return;
  }
  const bump = () => {
    listDataBump.value = 1;
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(bump));
  } else {
    window.setTimeout(bump, 0);
  }
};

const {
  getQueueVirtualRowKey,
  virtualListRows,
  virtualListBufferSizePx,
  virtualListItemSizePx,
  virtualListKey: virtualListKeyBase,
} = useQueuePanelVirtualRows(
  () => ({
    queueMode: props.queueMode,
    queueRowVariant: props.queueRowVariant,
    queueViewMode: props.queueViewMode,
    visibleQueueItems: props.visibleQueueItems,
    queueModeProcessingJobs: props.queueModeProcessingJobs,
    queueModeWaitingItems: props.queueModeWaitingItems,
    queueModeWaitingBatchIds: props.queueModeWaitingBatchIds,
  }),
  (key) => t(key) as string,
);

const virtualListKey = computed(() => {
  return `${virtualListKeyBase.value}|layout=${listViewportBump.value}|data=${listDataBump.value}`;
});

const virtualRowKeys = computed(() => virtualListRows.value.map((row) => getQueueVirtualRowKey(row)));
useFlipReorderAnimation(listViewportEl, virtualRowKeys, {
  enabled: () => listDataBump.value === 1,
  durationMs: 520,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
});

watch(
  listViewportEl,
  (el) => {
    if (el) return;
    listDataBump.value = 0;
    listDataBumped = false;
  },
  { flush: "sync" },
);

watch(
  () => virtualListRows.value.length,
  () => bumpListDataOnce(),
  { flush: "post" },
);

watch(listViewportHeightPx, () => bumpListDataOnce(), { flush: "post" });
</script>

<template>
  <section
    class="flex flex-1 min-h-0 flex-col gap-4 w-full min-w-0"
    data-testid="queue-panel"
    @contextmenu.prevent="(event) => emit('openBulkContextMenu', event)"
  >
    <!-- Empty state
         Only show when the queue is truly empty (no jobs and no batches) and
         no filters are active. When filters hide all jobs, keep the secondary
         header visible so users can adjust filters instead of seeing an
         "empty queue" screen. -->
    <div
      v-if="queueJobsForDisplay.length === 0 && !hasBatchCompressBatches && !hasActiveFilters"
      class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl hover:border-sidebar-ring/70 hover:text-foreground transition-all"
    >
      <div
        class="mx-auto mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-card/70"
        data-testid="ffui-empty-queue-badge"
      >
        <div
          :class="[
            'flex w-full max-w-full flex-col items-center justify-center px-1 text-center font-semibold text-muted-foreground',
            locale.startsWith('zh') ? 'text-[10px] leading-3' : 'text-[8px] leading-3 tracking-normal',
          ]"
          data-testid="ffui-empty-queue-badge-label"
        >
          <span
            v-for="(line, idx) in emptyQueueBadgeLines"
            :key="idx"
            :data-testid="`ffui-empty-queue-badge-line-${idx}`"
          >
            {{ line }}
          </span>
        </div>
      </div>
      <p class="text-lg font-medium">
        {{ t("app.emptyQueue.title") }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{ t("app.emptyQueue.subtitle") }}
      </p>
      <div class="mt-6 flex items-center justify-center">
        <div
          class="relative grid w-full max-w-xs grid-cols-2 overflow-hidden rounded-md after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-white/35"
        >
          <Button size="lg" class="rounded-none font-semibold text-white" @click="emit('addJobFiles')">
            {{ t("app.actions.addJobFiles") }}
          </Button>
          <Button
            size="lg"
            variant="manualFolder"
            class="rounded-none font-semibold text-white"
            @click="emit('addJobFolder')"
          >
            {{ t("app.actions.addJobFolder") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Queue content -->
    <div v-else class="flex flex-1 min-h-0 flex-col">
      <!-- 3D Carousel view mode -->
      <div
        v-if="isCarousel3dViewMode"
        class="flex flex-1 min-h-0 min-w-0 overflow-hidden"
        data-testid="ffui-queue-carousel-3d-wrapper"
      >
        <QueueCarousel3DView
          class="flex-1 min-h-0 min-w-0 h-full"
          :items="visibleQueueItems"
          :selected-job-ids="selectedJobIds"
          :progress-style="queueProgressStyle"
          :auto-rotation-speed="carouselAutoRotationSpeed"
          @toggle-job-selected="emit('toggleJobSelected', $event)"
          @inspect-job="emit('inspectJob', $event)"
          @preview-job="emit('previewJob', $event)"
          @compare-job="emit('compareJob', $event)"
          @open-job-context-menu="emit('openJobContextMenu', $event)"
          @open-batch-detail="emit('openBatchDetail', $event)"
          @toggle-batch-selection="handleToggleBatchSelection($event)"
          @contextmenu-batch="(payload) => handleBatchContextMenu(payload.batch, payload.event)"
        />
      </div>

      <!-- Icon view mode -->
      <div v-else-if="isIconViewMode" class="flex flex-1 min-h-0 overflow-hidden">
        <QueueIconVirtualGrid
          :items="iconViewItems"
          :icon-view-size="iconViewSize"
          :queue-progress-style="queueProgressStyle"
          :pausing-job-ids="pausingJobIds"
          :selected-job-ids="selectedJobIds"
          :is-batch-fully-selected="isBatchFullySelected"
          @toggle-job-selected="emit('toggleJobSelected', $event)"
          @inspect-job="emit('inspectJob', $event)"
          @preview-job="emit('previewJob', $event)"
          @compare-job="emit('compareJob', $event)"
          @open-job-context-menu="(payload) => emit('openJobContextMenu', payload)"
          @open-batch-detail="emit('openBatchDetail', $event)"
          @toggle-batch-selection="handleToggleBatchSelection($event)"
          @contextmenu-batch="(payload) => handleBatchContextMenu(payload.batch, payload.event)"
        />
      </div>

      <!-- List view mode -->
      <div v-else ref="listViewportEl" class="flex flex-1 min-h-0 flex-col overflow-hidden">
        <VList
          :key="virtualListKey"
          v-slot="{ item: row, index }"
          :data="virtualListRows"
          :buffer-size="virtualListBufferSizePx"
          :item-size="virtualListItemSizePx"
          class="flex-1 min-h-0"
          :style="{ height: `${listViewportHeightPx}px` }"
        >
          <div :key="getQueueVirtualRowKey(row)">
            <div
              class="queue-vlist-flip-inner"
              :class="row.type !== 'header' && queueRowVariant !== 'mini' ? 'pb-2' : ''"
              :data-queue-flip-key="getQueueVirtualRowKey(row)"
            >
              <template v-if="row.type === 'header'">
                <div
                  :class="[
                    'px-1',
                    index === 0
                      ? queueRowVariant === 'mini'
                        ? 'pb-2'
                        : 'pb-3'
                      : queueRowVariant === 'mini'
                        ? 'py-2'
                        : 'pt-1 pb-3',
                  ]"
                >
                  <div class="relative flex items-center justify-center h-6">
                    <div
                      class="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-border opacity-80"
                      aria-hidden="true"
                    />
                    <div class="relative max-w-[70%] bg-background px-3 text-center">
                      <span
                        class="text-xs font-semibold text-muted-foreground uppercase leading-none whitespace-nowrap"
                      >
                        {{ row.label }}
                      </span>
                    </div>
                    <div
                      class="absolute right-0 top-1/2 -translate-y-1/2 bg-background pl-2 pr-1 text-[11px] text-muted-foreground tabular-nums"
                    >
                      {{ row.count }}
                    </div>
                  </div>
                </div>
              </template>

              <template
                v-else-if="
                  row.type === 'processingJob' ||
                  ((row.type === 'waitingItem' || row.type === 'displayItem') && row.item.kind === 'job')
                "
              >
                <QueueItem
                  :job="row.type === 'processingJob' ? row.job : row.item.job"
                  :is-pausing="pausingJobIds.has(row.type === 'processingJob' ? row.job.id : row.item.job.id)"
                  :preset="getPresetForJob(row.type === 'processingJob' ? row.job : row.item.job)"
                  :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                  :can-cancel="canCancelJob(row.type === 'processingJob' ? row.job : row.item.job)"
                  :can-wait="hasTauri()"
                  :can-resume="hasTauri()"
                  :can-restart="hasTauri()"
                  :can-select="true"
                  :selected="selectedJobIds.has(row.type === 'processingJob' ? row.job.id : row.item.job.id)"
                  :view-mode="queueRowVariant"
                  :progress-style="queueProgressStyle"
                  :progress-update-interval-ms="progressUpdateIntervalMs"
                  v-on="queueItemListeners"
                />
              </template>

              <template v-else-if="row.type === 'waitingItem' || row.type === 'restItem' || row.type === 'displayItem'">
                <QueueBatchCompressBatchCard
                  v-if="row.item.kind === 'batch'"
                  v-bind="getBatchCardProps(row.item.batch)"
                  v-on="getBatchCardListeners(row.item.batch)"
                />
                <QueueItem
                  v-else-if="row.type === 'restItem'"
                  :job="row.item.job"
                  :is-pausing="pausingJobIds.has(row.item.job.id)"
                  :preset="getPresetForJob(row.item.job)"
                  :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                  :can-cancel="false"
                  :can-restart="hasTauri() && queueMode === 'queue'"
                  :can-select="true"
                  :selected="selectedJobIds.has(row.item.job.id)"
                  :view-mode="queueRowVariant"
                  :progress-style="queueProgressStyle"
                  :progress-update-interval-ms="progressUpdateIntervalMs"
                  v-on="queueItemListeners"
                />
              </template>
              <template v-else />
            </div>
          </div>
        </VList>
      </div>
    </div>
  </section>
</template>

<style scoped>
.queue-vlist-flip-inner {
  will-change: transform;
}

.queue-grid-move {
  transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.queue-grid-enter-active,
.queue-grid-leave-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

.queue-grid-enter-from,
.queue-grid-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.queue-grid-leave-active {
  position: absolute;
}
</style>
