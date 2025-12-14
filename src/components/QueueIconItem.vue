<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import type { QueueProgressStyle, TranscodeJob } from "@/types";
import { useI18n } from "vue-i18n";
import { buildPreviewUrl, ensureJobPreview, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import { useJobTimeDisplay } from "@/composables/useJobTimeDisplay";

const isTestEnv =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  import.meta.env.MODE === "test";

const props = defineProps<{
  job: TranscodeJob;
  /** UI-only: true when a pause request is pending while the job is still processing. */
  isPausing?: boolean;
  /**
   * Small/medium/large icon sizes map to slightly different typographic
   * scales but share the same structural layout.
   */
  size: "small" | "medium" | "large";
  /**
   * Progress style for this mini card. The queue passes the global
   * queueProgressStyle preference through.
   */
  progressStyle?: QueueProgressStyle;
  /**
   * When true, clicking the card toggles selection instead of opening
   * details. Used by the queue icon view to drive bulk operations.
   */
  canSelect?: boolean;
  /**
   * Selection state driven by the parent. The visual highlight mirrors
   * this flag and emits a `toggle-select` event when the card is clicked.
   */
  selected?: boolean;
}>();

const emit = defineEmits<{
  (e: "inspect", job: TranscodeJob): void;
  (e: "preview", job: TranscodeJob): void;
  (e: "toggle-select", id: string): void;
  (e: "contextmenu-job", payload: { job: TranscodeJob; event: MouseEvent }): void;
}>();

const { t } = useI18n();

const effectiveProgressStyle = computed<QueueProgressStyle>(
  () => props.progressStyle ?? "bar",
);

const clampedProgress = computed(() => {
  const status = props.job.status;

  if (
    status === "completed" ||
    status === "failed" ||
    status === "skipped" ||
    status === "cancelled"
  ) {
    return 100;
  }

  if (status === "processing" || status === "paused") {
    const raw =
      typeof props.job.progress === "number" ? props.job.progress : 0;
    return Math.max(0, Math.min(100, raw));
  }

  // waiting / queued
  return 0;
});

const showBarProgress = computed(
  () =>
    props.job.status !== "waiting" &&
    props.job.status !== "skipped" &&
    effectiveProgressStyle.value === "bar",
);

const showCardFillProgress = computed(
  () =>
    props.job.status !== "waiting" &&
    props.job.status !== "skipped" &&
    effectiveProgressStyle.value === "card-fill",
);

const showRippleCardProgress = computed(
  () =>
    props.job.status !== "waiting" &&
    props.job.status !== "skipped" &&
    effectiveProgressStyle.value === "ripple-card",
);

// 根据任务状态计算进度条颜色类
const progressColorClass = computed(() => {
  switch (props.job.status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "paused":
    case "waiting":
    case "queued":
      return "bg-amber-500";
    case "cancelled":
    case "skipped":
      return "bg-muted-foreground";
    case "processing":
    default:
      return "bg-primary";
  }
});

// 波纹进度条的渐变色类
const rippleProgressColorClass = computed(() => {
  switch (props.job.status) {
    case "completed":
      return "bg-gradient-to-r from-emerald-500/60 via-emerald-500 to-emerald-500/60";
    case "failed":
      return "bg-gradient-to-r from-red-500/60 via-red-500 to-red-500/60";
    case "paused":
    case "waiting":
    case "queued":
      return "bg-gradient-to-r from-amber-500/60 via-amber-500 to-amber-500/60";
    case "cancelled":
    case "skipped":
      return "bg-gradient-to-r from-muted-foreground/60 via-muted-foreground to-muted-foreground/60";
    case "processing":
    default:
      return "bg-gradient-to-r from-primary/60 via-primary to-primary/60";
  }
});

// 与列表视图保持一致：内部 queued 状态在文案层统一视为 waiting。
const displayStatusKey = computed(() =>
  props.isPausing ? "pausing" : props.job.status === "queued" ? "waiting" : props.job.status,
);

const statusLabel = computed(
  () => t(`queue.status.${displayStatusKey.value}`) as string,
);

const statusBadgeClass = computed(() => {
  switch (props.job.status) {
    case "completed":
      return "border-emerald-500/60 text-emerald-200 bg-emerald-500/20";
    case "processing":
      return "border-blue-500/60 text-blue-200 bg-blue-500/20";
    case "waiting":
    case "queued":
    case "paused":
      return "border-amber-500/60 text-amber-200 bg-amber-500/20";
    case "failed":
      return "border-red-500/60 text-red-200 bg-red-500/20";
    case "skipped":
    case "cancelled":
      return "border-muted-foreground/40 text-muted-foreground bg-muted/40";
    default:
      return "border-border text-muted-foreground bg-muted/40";
  }
});

const rootSizeClass = computed(() => {
  if (props.size === "small") return "text-[10px]";
  if (props.size === "large") return "text-xs";
  return "text-[11px]";
});

const thumbnailAspectClass = computed(() => {
  // 图标视图的缩略图统一保持相同纵横比，只通过网格列数控制宽度，
  // 避免不同尺寸之间“比例变形”的错觉。
  return "pt-[75%]";
});

const captionPaddingClass = computed(() => {
  if (props.size === "small") return "px-2 py-1";
  if (props.size === "large") return "px-3 py-2";
  return "px-2 py-1.5";
});

const displayFilename = computed(() => {
  const name = props.job.filename || "";
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? name.slice(idx + 1) : name;
});

const isSelectable = computed(() => props.canSelect === true);
const isSelected = computed(() => !!props.selected);

// 使用时间显示组合式函数
const {
  elapsedTimeDisplay,
  estimatedTotalTimeDisplay,
  shouldShowTimeInfo,
  isTerminalState,
  isProcessing,
} = useJobTimeDisplay(toRef(props, "job"));

// 时间显示文本（简短版本，适合图标视图）
const timeDisplayText = computed(() => {
  if (!shouldShowTimeInfo.value) return null;
  
  if (isTerminalState.value) {
    // 终态：显示总耗时
    if (elapsedTimeDisplay.value !== "-") {
      return elapsedTimeDisplay.value;
    }
    return null;
  }
  
  if (isProcessing.value || props.job.status === "paused") {
    // 处理中或暂停：显示已用时间 / 预估总时间
    const elapsed = elapsedTimeDisplay.value;
    const total = estimatedTotalTimeDisplay.value;
    
    if (elapsed !== "-" && total !== "-") {
      return `${elapsed}/${total}`;
    }
    if (elapsed !== "-") {
      return elapsed;
    }
  }
  
  return null;
});

const previewUrl = ref<string | null>(null);
const previewFallbackLoaded = ref(false);
const previewRescreenshotAttempted = ref(false);

watch(
  () => props.job.previewPath,
  (path) => {
    previewFallbackLoaded.value = false;
    previewRescreenshotAttempted.value = false;
    if (!path) {
      previewUrl.value = null;
      return;
    }
    previewUrl.value = buildPreviewUrl(path);
  },
  { immediate: true },
);

const handlePreviewError = async () => {
  const path = props.job.previewPath;
  if (!path) return;
  if (!hasTauri()) return;
  if (previewFallbackLoaded.value) return;

  try {
    const url = await loadPreviewDataUrl(path);
    previewUrl.value = url;
    previewFallbackLoaded.value = true;
  } catch (error) {
    if (previewRescreenshotAttempted.value) {
      console.error(
        "QueueIconItem: failed to load preview via data URL fallback",
        error,
      );
      return;
    }

	    previewRescreenshotAttempted.value = true;
	    if (!isTestEnv) {
	      console.warn(
	        "QueueIconItem: preview missing or unreadable, attempting regeneration",
	        error,
	      );
	    }

	    try {
	      const regenerated = await ensureJobPreview(props.job.id);
	      if (regenerated) {
	        previewUrl.value = buildPreviewUrl(regenerated);
        previewFallbackLoaded.value = false;
      }
    } catch (regenError) {
      console.error("QueueIconItem: failed to regenerate preview", regenError);
    }
  }
};

const onInspect = () => {
  emit("inspect", props.job);
};

const onPreview = (event: MouseEvent) => {
  event.stopPropagation();
  emit("preview", props.job);
};

const onCardClick = () => {
  if (isSelectable.value) {
    emit("toggle-select", props.job.id);
  } else {
    onInspect();
  }
};

const onCardContextMenu = (event: MouseEvent) => {
  emit("contextmenu-job", { job: props.job, event });
};
</script>

<template>
  <div
    class="relative rounded-lg border border-border/60 bg-card/80 overflow-hidden hover:border-primary/60 transition-all cursor-pointer ring-0"
    :class="[
      rootSizeClass,
      isSelectable && isSelected
        ? 'border-amber-500/70 !ring-1 ring-amber-500/60 bg-amber-500/5'
        : '',
    ]"
    data-testid="queue-icon-item"
    @click="onCardClick"
    @contextmenu.prevent.stop="onCardContextMenu"
  >
    <div
      class="relative w-full bg-muted/60"
      :class="thumbnailAspectClass"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt=""
        class="absolute inset-0 h-full w-full object-cover"
        @click="onPreview"
        @error="handlePreviewError"
      />
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] text-muted-foreground"
      >
        {{ displayFilename }}
      </div>

      <!-- Status corner badge -->
      <div class="absolute top-1 left-1">
        <span
          class="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
          :class="statusBadgeClass"
        >
          {{ statusLabel }}
        </span>
      </div>

      <!-- 选中指示器 -->
      <div
        v-if="isSelectable"
        class="absolute top-1 right-1 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all"
        :class="isSelected
          ? 'bg-amber-500 border-amber-500 text-white'
          : 'border-white/60 bg-black/30 hover:border-white hover:bg-black/50'"
      >
        <svg
          v-if="isSelected"
          class="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="3"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>

    <div
      class="relative border-t border-border/40 bg-card/80"
      :class="captionPaddingClass"
    >
      <p
        class="truncate text-[11px] font-medium text-foreground"
        :title="job.filename"
      >
        {{ displayFilename }}
      </p>
      <div class="mt-0.5 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
          <span>{{ statusLabel }}</span>
          <span
            v-if="timeDisplayText"
            class="font-mono"
            data-testid="queue-icon-item-time-display"
          >
            {{ timeDisplayText }}
          </span>
        </div>
        <button
          type="button"
          class="text-[10px] text-primary hover:underline flex-shrink-0"
          data-testid="queue-icon-item-detail-button"
          @click.stop="onInspect"
        >
          {{ t("jobDetail.title") }}
        </button>
      </div>

      <!-- 底部进度条：根据 progressStyle 切换不同视觉样式，颜色随任务状态变化 -->
      <div
        v-if="showBarProgress || showCardFillProgress || showRippleCardProgress"
        class="mt-1.5 h-1 w-full bg-muted/60 rounded-full overflow-hidden"
        data-testid="queue-icon-item-progress-container"
      >
        <div
          v-if="showBarProgress"
          class="h-full rounded-full transition-all duration-300"
          :class="progressColorClass"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-bar"
        />
        <div
          v-else-if="showCardFillProgress"
          class="h-full rounded-full transition-all duration-300"
          :class="progressColorClass"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-card-fill"
        />
        <div
          v-else
          class="h-full rounded-full transition-all duration-300 animate-pulse"
          :class="rippleProgressColorClass"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-ripple-card"
        />
      </div>
    </div>
  </div>
</template>
