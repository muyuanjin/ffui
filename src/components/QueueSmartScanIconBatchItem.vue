<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CompositeSmartScanTask, QueueProgressStyle } from "@/types";
import { Badge } from "@/components/ui/badge";
import { buildPreviewUrl } from "@/lib/backend";

const props = defineProps<{
  batch: CompositeSmartScanTask;
  size: "small" | "medium" | "large";
  progressStyle?: QueueProgressStyle;
  /**
   * 是否可以选中该复合任务卡片，用于批量操作
   */
  canSelect?: boolean;
  /**
   * 选中状态，由父组件驱动
   */
  selected?: boolean;
}>();

const emit = defineEmits<{
  (e: "open-detail", batch: CompositeSmartScanTask): void;
  (e: "toggle-select", batchId: string): void;
  (e: "contextmenu-batch", payload: { batch: CompositeSmartScanTask; event: MouseEvent }): void;
}>();

const isSelectable = computed(() => props.canSelect === true);
const isSelected = computed(() => !!props.selected);

const { t } = useI18n();

const effectiveProgressStyle = computed<QueueProgressStyle>(() => props.progressStyle ?? "bar");

const clampedProgress = computed(() => Math.max(0, Math.min(100, props.batch.overallProgress ?? 0)));

const showBarProgress = computed(() => clampedProgress.value > 0 && effectiveProgressStyle.value === "bar");

const showCardFillProgress = computed(() => clampedProgress.value > 0 && effectiveProgressStyle.value === "card-fill");

const showRippleCardProgress = computed(
  () => clampedProgress.value > 0 && effectiveProgressStyle.value === "ripple-card",
);

// 根据批次状态计算进度条颜色类
const progressColorClass = computed(() => {
  const { completedCount, failedCount, cancelledCount, totalCount, jobs } = props.batch;
  const hasProcessing = jobs.some((j) => j.status === "processing");
  const hasPaused = jobs.some((j) => j.status === "paused" || j.status === "waiting" || j.status === "queued");

  // 全部完成 - 使用与普通任务一致的绿色
  if (completedCount === totalCount && totalCount > 0) {
    return "bg-emerald-500";
  }
  // 有失败
  if (failedCount > 0) {
    return "bg-red-500/40";
  }
  // 有取消且没有正在处理
  if (cancelledCount > 0 && !hasProcessing) {
    return "bg-muted-foreground/40";
  }
  // 有暂停/等待且没有正在处理
  if (hasPaused && !hasProcessing) {
    return "bg-amber-500/40";
  }
  // 默认处理中
  return "bg-primary/40";
});

// 波纹进度条的渐变色类
const rippleProgressColorClass = computed(() => {
  const { completedCount, failedCount, cancelledCount, totalCount, jobs } = props.batch;
  const hasProcessing = jobs.some((j) => j.status === "processing");
  const hasPaused = jobs.some((j) => j.status === "paused" || j.status === "waiting" || j.status === "queued");

  if (completedCount === totalCount && totalCount > 0) {
    return "bg-gradient-to-r from-emerald-500/30 via-emerald-500/60 to-emerald-500/30";
  }
  if (failedCount > 0) {
    return "bg-gradient-to-r from-red-500/30 via-red-500/60 to-red-500/30";
  }
  if (cancelledCount > 0 && !hasProcessing) {
    return "bg-gradient-to-r from-muted-foreground/30 via-muted-foreground/60 to-muted-foreground/30";
  }
  if (hasPaused && !hasProcessing) {
    return "bg-gradient-to-r from-amber-500/30 via-amber-500/60 to-amber-500/30";
  }
  return "bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30";
});

const rootSizeClass = computed(() => {
  if (props.size === "small") return "text-[10px]";
  if (props.size === "large") return "text-xs";
  return "text-[11px]";
});

const thumbnailAspectClass = computed(() => {
  // 与单个 QueueIconItem 一致，统一纵横比，只靠列数区分大小。
  return "pt-[75%]";
});

const captionPaddingClass = computed(() => {
  if (props.size === "small") return "px-2 py-1";
  if (props.size === "large") return "px-3 py-2";
  return "px-2 py-1.5";
});

type PreviewSlot = {
  key: string;
  previewPath: string | null;
};

const previewSlots = computed<PreviewSlot[]>(() => {
  const jobs = props.batch.jobs ?? [];
  const slots: PreviewSlot[] = [];
  const usedJobIds = new Set<string>();

  // 统一处理图片/视频的有效预览路径：图片缺失 previewPath 时回退到 outputPath/inputPath。
  const getEffectivePreviewPath = (job: (typeof jobs)[number]): string | null => {
    if (job.previewPath) return job.previewPath;
    if (job.type === "image") {
      return job.outputPath || job.inputPath || null;
    }
    return job.previewPath ?? null;
  };

  type SlotSource = {
    job: (typeof jobs)[number];
    previewPath: string | null;
  };

  const jobsWithPreview: SlotSource[] = [];
  const jobsWithoutPreview: SlotSource[] = [];

  for (const job of jobs) {
    const previewPath = getEffectivePreviewPath(job);
    if (previewPath) {
      jobsWithPreview.push({ job, previewPath });
    } else {
      jobsWithoutPreview.push({ job, previewPath: null });
    }
  }

  const pushJobSlot = (source: SlotSource) => {
    if (slots.length >= 9) return;
    const id = source.job.id;
    if (usedJobIds.has(id)) return;
    usedJobIds.add(id);

    slots.push({
      key: id,
      previewPath: source.previewPath,
    });
  };

  // 优先填充有预览的子任务，且每个子任务最多出现一次，避免重复缩略图。
  for (const source of jobsWithPreview) {
    if (slots.length >= 9) break;
    pushJobSlot(source);
  }

  // 其余槽位用没有预览的子任务占位（会显示灰色占位块），同样保证不重复。
  for (const source of jobsWithoutPreview) {
    if (slots.length >= 9) break;
    pushJobSlot(source);
  }

  // 不足 9 个时补齐占位槽，保持九宫格稳定布局。
  while (slots.length < 9) {
    const index = slots.length;
    slots.push({
      key: `placeholder-${index}`,
      previewPath: null,
    });
  }

  return slots;
});

const videosCount = computed(() => props.batch.jobs.filter((job) => job.type === "video").length);

const imagesCount = computed(() => props.batch.jobs.filter((job) => job.type === "image").length);

const audioCount = computed(() => props.batch.jobs.filter((job) => job.type === "audio").length);

const folderName = computed(() => {
  const raw = props.batch.rootPath || "";
  if (!raw) return t("smartScan.title") as string;
  const normalized = raw.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments[segments.length - 1];
  return last || normalized;
});

const firstPreviewUrl = computed<string | null>(() => {
  const jobWithPreview = props.batch.jobs.find(
    (job) => typeof job.previewPath === "string" && job.previewPath.length > 0,
  );
  if (!jobWithPreview?.previewPath) return null;
  return buildPreviewUrl(jobWithPreview.previewPath);
});

const progressLabel = computed(() => `${Math.round(clampedProgress.value)}%`);

const onPreviewClick = (event: MouseEvent) => {
  // 在网格视图中，点击 9 宫格缩略图应始终优先展开复合任务详情，而不是触发卡片选中。
  event.stopPropagation();
  emit("open-detail", props.batch);
};

const onClick = () => {
  if (isSelectable.value) {
    emit("toggle-select", props.batch.batchId);
  } else {
    emit("open-detail", props.batch);
  }
};

const onContextMenu = (event: MouseEvent) => {
  emit("contextmenu-batch", { batch: props.batch, event });
};
</script>

<template>
  <div
    class="relative rounded-lg border border-border/60 bg-card/80 overflow-hidden hover:border-primary/60 transition-all cursor-pointer ring-0"
    :class="[
      rootSizeClass,
      isSelectable && isSelected ? 'border-amber-500/70 !ring-1 ring-amber-500/60 bg-amber-500/5' : '',
    ]"
    data-testid="queue-icon-batch-item"
    @click="onClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <div class="relative w-full bg-muted/40" :class="thumbnailAspectClass">
      <div class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px bg-muted/40" @click="onPreviewClick">
        <div v-for="slot in previewSlots" :key="slot.key" class="bg-background/40 overflow-hidden">
          <img
            v-if="slot.previewPath"
            :src="buildPreviewUrl(slot.previewPath) ?? undefined"
            alt=""
            class="h-full w-full object-cover"
          />
          <div v-else class="h-full w-full bg-muted/60" />
        </div>
      </div>

      <div class="absolute top-1 left-1 flex items-center gap-1">
        <Badge
          variant="outline"
          class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-200 bg-blue-500/15"
        >
          {{ t("queue.source.smartScan") }}
        </Badge>
        <span class="text-[10px] text-muted-foreground bg-background/80 rounded-full px-1.5 py-0.5">
          {{ batch.totalProcessed }} / {{ batch.totalCandidates }}
        </span>
      </div>

      <!-- 选中指示器 -->
      <div
        v-if="isSelectable"
        class="absolute top-1 right-1 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all z-10"
        :class="
          isSelected
            ? 'bg-amber-500 border-amber-500 text-white'
            : 'border-white/60 bg-black/30 hover:border-white hover:bg-black/50'
        "
        @click.stop="emit('toggle-select', batch.batchId)"
      >
        <svg v-if="isSelected" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div
        v-else
        class="absolute top-1 right-1 text-[10px] font-mono text-muted-foreground bg-background/80 rounded-full px-1.5 py-0.5"
      >
        {{ progressLabel }}
      </div>
    </div>

    <div class="relative border-t border-border/40 bg-card/80 overflow-hidden" :class="captionPaddingClass">
      <!-- 在网格视图中，进度通过底部说明区域的背景表现，避免覆盖预览九宫格。颜色随批次状态变化 -->
      <div
        v-if="showBarProgress"
        class="absolute inset-y-0 left-0"
        :class="progressColorClass"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-bar"
      />
      <div
        v-else-if="showCardFillProgress"
        class="absolute inset-y-0 left-0 overflow-hidden"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-card-fill"
      >
        <img v-if="firstPreviewUrl" :src="firstPreviewUrl" alt="" class="h-full w-full object-cover opacity-80" />
        <div v-else class="h-full w-full bg-gradient-to-r from-card/40 via-card/20 to-card/0" />
      </div>
      <div
        v-else-if="showRippleCardProgress"
        class="absolute inset-y-0 left-0"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-ripple-card"
      >
        <div class="h-full w-full opacity-80 animate-pulse" :class="rippleProgressColorClass" />
      </div>

      <p class="relative truncate text-[11px] font-medium text-foreground" :title="folderName">
        {{ folderName }}
      </p>
      <p class="relative mt-0.5 text-[10px] text-muted-foreground truncate">
        {{ videosCount }} {{ t("queue.typeVideo") }} / {{ imagesCount }} {{ t("queue.typeImage") }} / {{ audioCount }}
        {{ t("queue.typeAudio") }} · {{ t("queue.status.completed") }} {{ batch.completedCount }} /
        {{ batch.totalCount - batch.skippedCount }}
      </p>
    </div>
  </div>
</template>
