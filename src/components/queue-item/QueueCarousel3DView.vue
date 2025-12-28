<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, reactive, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import type { TranscodeJob, QueueProgressStyle, CompositeBatchCompressTask } from "@/types";
import type { QueueListItem } from "@/composables";
import { buildJobPreviewUrl, buildPreviewUrl, hasTauri } from "@/lib/backend";
import { requestJobPreviewAutoEnsure } from "@/components/queue-item/previewAutoEnsure";
import { useQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { createWheelSoftSnapController } from "@/lib/wheelSoftSnap";
import QueueCarousel3DHeader from "@/components/queue-item/QueueCarousel3DHeader.vue";
import QueueCarousel3DFooter from "@/components/queue-item/QueueCarousel3DFooter.vue";
import QueueCarousel3DCardContent from "@/components/queue-item/QueueCarousel3DCardContent.vue";
import {
  computeCarousel3DLayout,
  computeCarouselCardStyle,
  getCarouselDisplayFilename,
  isCarouselItemSelected,
  isCarouselCardVisible,
} from "./queueCarousel3dView.helpers";

const props = defineProps<{
  items: QueueListItem[];
  selectedJobIds: Set<string>;
  progressStyle: QueueProgressStyle;
  autoRotationSpeed: number;
}>();

const emit = defineEmits<{
  toggleJobSelected: [jobId: string];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  compareJob: [job: TranscodeJob];
  openJobContextMenu: [payload: { job: TranscodeJob; event: MouseEvent }];
  openBatchDetail: [batch: CompositeBatchCompressTask];
  toggleBatchSelection: [batch: CompositeBatchCompressTask];
  contextmenuBatch: [payload: { batch: CompositeBatchCompressTask; event: MouseEvent }];
}>();

const { t } = useI18n();

const activeIndex = ref(0);
const isDragging = ref(false);
const dragStartX = ref(0);
const dragOffset = ref(0);
const containerRef = ref<HTMLElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);

const previewCache = reactive<Record<string, string | null>>({});
const pendingPreviewEnsures = new Map<string, { promise: Promise<string | null>; cancel: () => void }>();

const perfHints = useQueuePerfHints();
const allowAutoEnsure = computed(() => perfHints?.allowPreviewAutoEnsure.value ?? true);

let autoRotationTimer: ReturnType<typeof setInterval> | null = null;
let stageResizeObserver: ResizeObserver | null = null;
let stageResizeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

const stageLayout = ref(
  computeCarousel3DLayout({
    stageWidth: 0,
    stageHeight: 0,
  }),
);

const wheelSnap = createWheelSoftSnapController({
  getThresholdPx: () => {
    const base = stageLayout.value.dragPixelsPerStep || 200;
    return Math.min(110, Math.max(36, base * 0.28));
  },
  getPageSizePx: () => containerRef.value?.clientHeight || stageLayout.value.stageHeight || 800,
  minIntervalMs: 35,
  gestureResetMs: 150,
  maxAccumulatedPx: 900,
});

const refreshStageLayout = () => {
  const el = stageRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  stageLayout.value = computeCarousel3DLayout({ stageWidth: rect.width, stageHeight: rect.height });
};

const scheduleStageLayoutRefresh = () => {
  if (stageResizeFallbackTimer) clearTimeout(stageResizeFallbackTimer);
  stageResizeFallbackTimer = setTimeout(() => {
    stageResizeFallbackTimer = null;
    refreshStageLayout();
  }, 0);
};

const carouselLayout = computed(() => stageLayout.value);

const displayedItems = computed(() => {
  return props.items.slice(0, Math.min(props.items.length, 50));
});

const maxLayers = computed(() => 7);

const getItemKey = (item: QueueListItem): string => {
  return item.kind === "batch" ? `batch-${item.batch.batchId}` : `job-${item.job.id}`;
};

const getItemJob = (item: QueueListItem): TranscodeJob | null => {
  if (item.kind === "job") return item.job;
  if (item.kind === "batch" && item.batch.currentJob) return item.batch.currentJob;
  if (item.kind === "batch" && item.batch.jobs.length > 0) return item.batch.jobs[0];
  return null;
};

const getPreviewUrl = (item: QueueListItem): string | null => {
  const job = getItemJob(item);
  if (!job) return null;

  if (previewCache[job.id]) {
    return buildJobPreviewUrl(previewCache[job.id], job.previewRevision);
  }

  if (job.previewPath) {
    return buildJobPreviewUrl(job.previewPath, job.previewRevision);
  }

  if (job.type === "image") {
    return buildPreviewUrl(job.outputPath || job.inputPath || null);
  }

  return null;
};

const ensurePreviewForItem = async (item: QueueListItem) => {
  const job = getItemJob(item);
  if (!job) return;
  if (previewCache[job.id] || job.type !== "video") return;
  if (!hasTauri()) return;
  if (!allowAutoEnsure.value) return;
  if (pendingPreviewEnsures.has(job.id)) return;

  try {
    const handle = requestJobPreviewAutoEnsure(job.id, { heightPx: 1080 });
    pendingPreviewEnsures.set(job.id, handle);
    const path = await handle.promise;
    if (path) previewCache[job.id] = path;
  } catch {
    // silent
  } finally {
    pendingPreviewEnsures.delete(job.id);
  }
};

watch(
  activeIndex,
  (newIndex) => {
    const items = displayedItems.value;
    const keep = new Set<string>();
    for (let i = Math.max(0, newIndex - 2); i <= Math.min(items.length - 1, newIndex + 2); i++) {
      const job = getItemJob(items[i]);
      if (job) keep.add(job.id);
      ensurePreviewForItem(items[i]);
    }
    for (const [jobId, handle] of pendingPreviewEnsures) {
      if (keep.has(jobId)) continue;
      handle.cancel();
      pendingPreviewEnsures.delete(jobId);
    }
  },
  { immediate: true },
);

watch(
  allowAutoEnsure,
  (allowed) => {
    if (!allowed) {
      for (const handle of pendingPreviewEnsures.values()) {
        handle.cancel();
      }
      pendingPreviewEnsures.clear();
      return;
    }

    const items = displayedItems.value;
    for (let i = Math.max(0, activeIndex.value - 2); i <= Math.min(items.length - 1, activeIndex.value + 2); i++) {
      void ensurePreviewForItem(items[i]);
    }
  },
  { flush: "post" },
);

const getCardStyle = (index: number) => {
  return computeCarouselCardStyle({
    index,
    activeIndex: activeIndex.value,
    totalCards: displayedItems.value.length,
    isDragging: isDragging.value,
    dragOffset: dragOffset.value,
    layout: stageLayout.value,
  });
};

const isCardVisible = (index: number) => {
  return isCarouselCardVisible(index, activeIndex.value, maxLayers.value);
};

const handlePointerDown = (e: PointerEvent) => {
  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragOffset.value = 0;
  (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
  stopAutoRotation();
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return;
  dragOffset.value = e.clientX - dragStartX.value;
};

const handlePointerUp = (e: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;

  const len = displayedItems.value.length;
  const threshold = 50;
  if (Math.abs(dragOffset.value) > threshold && len > 0) {
    if (dragOffset.value > 0) {
      // 向右拖拽，前一个（无限循环）
      activeIndex.value = (activeIndex.value - 1 + len) % len;
    } else {
      // 向左拖拽，下一个（无限循环）
      activeIndex.value = (activeIndex.value + 1) % len;
    }
  }
  dragOffset.value = 0;
  (e.target as HTMLElement)?.releasePointerCapture(e.pointerId);
  startAutoRotation();
};

const handleWheel = (e: WheelEvent) => {
  const len = displayedItems.value.length;
  if (len === 0) return;

  wheelSnap.onWheel(e, {
    shouldConsume: () => true,
    onStep: (direction) => {
      if (len === 0) return false;
      if (direction > 0) {
        // 向下/向右滚动，下一个（无限循环）
        activeIndex.value = (activeIndex.value + 1) % len;
        return true;
      }
      // 向上/向左滚动，前一个（无限循环）
      activeIndex.value = (activeIndex.value - 1 + len) % len;
      return true;
    },
  });
};

const handleCardClick = (index: number, item: QueueListItem) => {
  if (isDragging.value) return;
  if (index === activeIndex.value) {
    if (item.kind === "job") {
      emit("toggleJobSelected", item.job.id);
    } else {
      emit("toggleBatchSelection", item.batch);
    }
  } else {
    activeIndex.value = index;
  }
};

const handleCardDoubleClick = (item: QueueListItem) => {
  if (item.kind === "job") {
    emit("inspectJob", item.job);
  } else {
    emit("openBatchDetail", item.batch);
  }
};

const handleCardContextMenu = (e: MouseEvent, item: QueueListItem) => {
  e.preventDefault();
  e.stopPropagation();
  if (item.kind === "job") {
    emit("openJobContextMenu", { job: item.job, event: e });
  } else {
    emit("contextmenuBatch", { batch: item.batch, event: e });
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  const len = displayedItems.value.length;
  if (len === 0) return;
  if (e.key === "ArrowLeft") {
    // 前一个（无限循环）
    activeIndex.value = (activeIndex.value - 1 + len) % len;
  } else if (e.key === "ArrowRight") {
    // 下一个（无限循环）
    activeIndex.value = (activeIndex.value + 1) % len;
  } else if (e.key === "Enter" || e.key === " ") {
    const item = displayedItems.value[activeIndex.value];
    if (item) {
      if (item.kind === "job") {
        emit("toggleJobSelected", item.job.id);
      } else {
        emit("toggleBatchSelection", item.batch);
      }
    }
  }
};

const startAutoRotation = () => {
  if (props.autoRotationSpeed <= 0) return;
  stopAutoRotation();
  const intervalMs = Math.max(500, 5000 / props.autoRotationSpeed);
  autoRotationTimer = setInterval(() => {
    if (activeIndex.value < displayedItems.value.length - 1) {
      activeIndex.value++;
    } else {
      activeIndex.value = 0;
    }
  }, intervalMs);
};

const stopAutoRotation = () => {
  if (autoRotationTimer) {
    clearInterval(autoRotationTimer);
    autoRotationTimer = null;
  }
};

watch(
  () => props.autoRotationSpeed,
  () => {
    stopAutoRotation();
    startAutoRotation();
  },
);

watch(
  () => props.items.length,
  () => {
    if (activeIndex.value >= props.items.length) {
      activeIndex.value = Math.max(0, props.items.length - 1);
    }
  },
);

onMounted(() => {
  containerRef.value?.addEventListener("wheel", handleWheel, { passive: false });
  nextTick(() => {
    refreshStageLayout();
  });
  if (typeof ResizeObserver !== "undefined") {
    stageResizeObserver = new ResizeObserver(() => {
      scheduleStageLayoutRefresh();
    });
    if (stageRef.value) stageResizeObserver.observe(stageRef.value);
  } else if (typeof window !== "undefined") {
    window.addEventListener("resize", scheduleStageLayoutRefresh, { passive: true });
  }
  startAutoRotation();
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("wheel", handleWheel);
  wheelSnap.reset();
  for (const handle of pendingPreviewEnsures.values()) {
    handle.cancel();
  }
  pendingPreviewEnsures.clear();
  if (stageResizeObserver) {
    stageResizeObserver.disconnect();
    stageResizeObserver = null;
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", scheduleStageLayoutRefresh);
  }
  if (stageResizeFallbackTimer) {
    clearTimeout(stageResizeFallbackTimer);
    stageResizeFallbackTimer = null;
  }
  stopAutoRotation();
});

const isItemSelected = (item: QueueListItem): boolean => {
  return isCarouselItemSelected(item, props.selectedJobIds);
};

const getDisplayFilename = (item: QueueListItem): string => {
  return getCarouselDisplayFilename(item, (key) => t(key) as string);
};
</script>

<template>
  <div
    v-if="displayedItems.length > 0"
    ref="containerRef"
    data-testid="ffui-carousel-3d-container"
    class="carousel-3d-container relative select-none outline-none flex flex-1 min-h-0 h-full w-full flex-col items-center overflow-hidden py-2"
    tabindex="0"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
    @keydown="handleKeyDown"
  >
    <QueueCarousel3DHeader
      :total-items="items.length"
      :active-index="activeIndex"
      :displayed-length="displayedItems.length"
    />

    <!-- 卡片轮播区域 - 填满剩余空间 -->
    <!-- NOTE: `z-0` creates a stacking context so card `zIndex` cannot cover header/pagination/hint. -->
    <div ref="stageRef" data-testid="ffui-carousel-3d-stage" class="relative z-0 w-full flex-1 min-h-0">
      <div class="absolute inset-0 flex items-end justify-center overflow-visible">
        <template v-for="(item, index) in displayedItems" :key="getItemKey(item)">
          <div
            v-if="isCardVisible(index)"
            data-testid="ffui-carousel-3d-card"
            :data-active="index === activeIndex ? 'true' : 'false'"
            :data-index="String(index)"
            class="carousel-card absolute rounded-xl border border-border/60 bg-card/95 shadow-xl overflow-hidden cursor-pointer hover:border-primary/50 flex flex-col"
            :class="{
              'ring-2 ring-primary/60 border-primary/70': index === activeIndex,
              'ring-2 ring-amber-500/60 border-amber-500/70': isItemSelected(item),
            }"
            :style="{
              ...getCardStyle(index),
              width: `${carouselLayout.cardWidth}px`,
              height: `${carouselLayout.cardHeight}px`,
            }"
            @click="handleCardClick(index, item)"
            @dblclick="handleCardDoubleClick(item)"
            @contextmenu="handleCardContextMenu($event, item)"
          >
            <QueueCarousel3DCardContent
              :item="item"
              :preview-url="getPreviewUrl(item)"
              :display-filename="getDisplayFilename(item)"
              :selected="isItemSelected(item)"
              @inspect-job="emit('inspectJob', $event)"
              @open-batch-detail="emit('openBatchDetail', $event)"
              @compare-job="emit('compareJob', $event)"
            />
          </div>
        </template>
      </div>
    </div>

    <QueueCarousel3DFooter
      :active-index="activeIndex"
      :displayed-length="displayedItems.length"
      @select-index="activeIndex = $event"
    />
  </div>
</template>

<style scoped>
.carousel-3d-container {
  touch-action: pan-y;
}

.carousel-card {
  backface-visibility: hidden;
  will-change: transform, opacity;
}

.carousel-3d-container:focus {
  outline: none;
}

.carousel-3d-container:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
  border-radius: 0.75rem;
}
</style>
