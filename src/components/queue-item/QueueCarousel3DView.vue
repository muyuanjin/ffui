<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, reactive } from "vue";
import { useI18n } from "vue-i18n";
import type { TranscodeJob, QueueProgressStyle, CompositeBatchCompressTask } from "@/types";
import type { QueueListItem } from "@/composables";
import { buildJobPreviewUrl, buildPreviewUrl, ensureJobPreview, hasTauri } from "@/lib/backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Folder } from "lucide-vue-next";
import QueueJobWarnings from "@/components/queue-item/QueueJobWarnings.vue";
import {
  computeCarouselCardStyle,
  getProgressVariant,
  getStatusClass,
  getTypeIcon,
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

const previewCache = reactive<Record<string, string | null>>({});

let autoRotationTimer: ReturnType<typeof setInterval> | null = null;

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
  if (job.previewPath || previewCache[job.id] || job.type !== "video") return;
  if (!hasTauri()) return;

  try {
    const path = await ensureJobPreview(job.id);
    if (path) {
      previewCache[job.id] = path;
    }
  } catch {
    // silent
  }
};

watch(
  activeIndex,
  (newIndex) => {
    const items = displayedItems.value;
    for (let i = Math.max(0, newIndex - 2); i <= Math.min(items.length - 1, newIndex + 2); i++) {
      ensurePreviewForItem(items[i]);
    }
  },
  { immediate: true },
);

const getCardStyle = (index: number) => {
  return computeCarouselCardStyle({
    index,
    activeIndex: activeIndex.value,
    totalCards: displayedItems.value.length,
    isDragging: isDragging.value,
    dragOffset: dragOffset.value,
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
  e.preventDefault();
  const len = displayedItems.value.length;
  if (len === 0) return;
  if (e.deltaX > 20 || e.deltaY > 20) {
    // 向下/向右滚动，下一个（无限循环）
    activeIndex.value = (activeIndex.value + 1) % len;
  } else if (e.deltaX < -20 || e.deltaY < -20) {
    // 向上/向左滚动，前一个（无限循环）
    activeIndex.value = (activeIndex.value - 1 + len) % len;
  }
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
  startAutoRotation();
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("wheel", handleWheel);
  stopAutoRotation();
});

const isItemSelected = (item: QueueListItem): boolean => {
  if (item.kind === "job") {
    return props.selectedJobIds.has(item.job.id);
  }
  return item.batch.jobs.every((j) => props.selectedJobIds.has(j.id));
};

const getDisplayFilename = (item: QueueListItem): string => {
  if (item.kind === "batch") {
    return item.batch.rootPath?.split(/[/\\]/).pop() || t("batchCompress.title");
  }
  const name = item.job.filename || "";
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? name.slice(idx + 1) : name;
};
</script>

<template>
  <div
    v-if="displayedItems.length > 0"
    ref="containerRef"
    data-testid="ffui-carousel-3d-container"
    class="carousel-3d-container relative select-none outline-none flex flex-1 min-h-0 w-full flex-col items-center py-3 h-full"
    tabindex="0"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
    @keydown="handleKeyDown"
  >
    <!-- 标题栏 -->
    <div data-testid="ffui-carousel-3d-header" class="flex items-center justify-between w-full mb-3 px-4 relative z-10">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground">{{ t("app.tabs.queue") }}</span>
        <Badge variant="secondary" class="text-xs px-1.5 py-0">
          {{ items.length }}
        </Badge>
      </div>
      <span class="text-xs text-muted-foreground font-mono"> {{ activeIndex + 1 }} / {{ displayedItems.length }} </span>
    </div>

    <!-- 卡片轮播区域 - 使用更大的高度 -->
    <!-- NOTE: `z-0` creates a stacking context so card `zIndex` cannot cover header/pagination/hint. -->
    <div data-testid="ffui-carousel-3d-stage" class="relative z-0 w-full flex-1 min-h-[380px]">
      <div class="absolute inset-0 flex items-center justify-center overflow-visible">
        <template v-for="(item, index) in displayedItems" :key="getItemKey(item)">
          <div
            v-if="isCardVisible(index)"
            data-testid="ffui-carousel-3d-card"
            :data-active="index === activeIndex ? 'true' : 'false'"
            class="carousel-card absolute rounded-xl border border-border/60 bg-card/95 shadow-xl overflow-hidden cursor-pointer hover:border-primary/50"
            :class="{
              'ring-2 ring-primary/60 border-primary/70': index === activeIndex,
              'ring-2 ring-amber-500/60 border-amber-500/70': isItemSelected(item),
            }"
            :style="{
              ...getCardStyle(index),
              width: 'calc(100% - 2rem)',
              height: 'calc(100% - 1rem)',
            }"
            @click="handleCardClick(index, item)"
            @dblclick="handleCardDoubleClick(item)"
            @contextmenu="handleCardContextMenu($event, item)"
          >
            <div class="relative h-[55%] bg-muted/50 overflow-hidden">
              <img
                v-if="getPreviewUrl(item)"
                :src="getPreviewUrl(item) ?? undefined"
                alt=""
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <component
                  :is="item.kind === 'batch' ? Folder : getTypeIcon(item.kind === 'job' ? item.job.type : 'video')"
                  class="h-16 w-16 text-muted-foreground/30"
                />
              </div>

              <div class="absolute top-2 left-2">
                <Badge
                  v-if="item.kind === 'job'"
                  variant="outline"
                  class="px-1.5 py-0.5 text-[10px] font-medium"
                  :class="getStatusClass(item.job.status)"
                >
                  {{ t(`queue.status.${item.job.status === "queued" ? "waiting" : item.job.status}`) }}
                </Badge>
                <Badge
                  v-else
                  variant="outline"
                  class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300 bg-blue-500/20"
                >
                  {{ t("queue.source.batchCompress") }}
                </Badge>
              </div>

              <div
                v-if="isItemSelected(item)"
                class="absolute top-2 right-2 h-6 w-6 rounded-full bg-amber-500 border-2 border-amber-500 text-white flex items-center justify-center"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <div class="p-3 space-y-2">
              <div class="flex items-center gap-2">
                <p class="flex-1 text-sm font-medium text-foreground truncate" :title="getDisplayFilename(item)">
                  {{ getDisplayFilename(item) }}
                </p>
                <QueueJobWarnings v-if="item.kind === 'job'" :warnings="item.job.warnings" />
              </div>

              <div v-if="item.kind === 'job'" class="space-y-1">
                <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{{ t(`queue.status.${item.job.status === "queued" ? "waiting" : item.job.status}`) }}</span>
                  <span v-if="item.job.progress > 0 && item.job.progress < 100" class="font-mono">
                    {{ Math.round(item.job.progress) }}%
                  </span>
                </div>
                <Progress
                  v-if="item.job.status !== 'waiting' && item.job.status !== 'skipped'"
                  :model-value="item.job.progress"
                  :variant="getProgressVariant(item.job.status) as any"
                  class="h-1.5"
                />
              </div>

              <div v-else class="space-y-1">
                <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span> {{ item.batch.completedCount }} / {{ item.batch.totalCandidates }} </span>
                  <span class="font-mono">{{ Math.round(item.batch.overallProgress) }}%</span>
                </div>
                <Progress :model-value="item.batch.overallProgress" class="h-1.5" />
              </div>

              <div class="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  class="h-auto p-0 text-[10px]"
                  @click.stop="item.kind === 'job' ? emit('inspectJob', item.job) : emit('openBatchDetail', item.batch)"
                >
                  {{ t("jobDetail.title") }}
                </Button>
                <Button
                  v-if="item.kind === 'job' && item.job.type === 'video'"
                  type="button"
                  variant="link"
                  size="sm"
                  class="h-auto p-0 text-[10px]"
                  @click.stop="emit('compareJob', item.job)"
                >
                  {{ t("jobCompare.open") }}
                </Button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 导航点 -->
    <div
      v-if="displayedItems.length > 1"
      data-testid="ffui-carousel-3d-pagination"
      class="flex justify-center items-center gap-1 mt-3 relative z-10"
    >
      <button
        v-for="(_, index) in displayedItems.slice(0, 15)"
        :key="index"
        class="w-1.5 h-1.5 rounded-full transition-all"
        :class="index === activeIndex ? 'bg-primary w-3' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        @click="activeIndex = index"
      />
      <span v-if="displayedItems.length > 15" class="text-[9px] text-muted-foreground/60 ml-1">
        +{{ displayedItems.length - 15 }}
      </span>
    </div>

    <!-- 提示文字 -->
    <p data-testid="ffui-carousel-3d-hint" class="text-center text-[10px] text-muted-foreground/60 mt-2 relative z-10">
      {{ t("queue.skippedStackHint") }}
    </p>
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
