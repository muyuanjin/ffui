<script setup lang="ts">
import { computed, toRef, onUpdated } from "vue";
import { Button } from "@/components/ui/button";
import type { QueueProgressStyle, TranscodeJob } from "@/types";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { useJobTimeDisplay } from "@/composables/useJobTimeDisplay";
import QueueJobWarnings from "@/components/queue-item/QueueJobWarnings.vue";
import { getJobCompareDisabledReason, isJobCompareEligible } from "@/lib/jobCompare";
import { isQueuePerfEnabled, recordQueueIconItemUpdate } from "@/lib/queuePerf";
import { useQueueItemPreview } from "@/components/queue-item/useQueueItemPreview";
import { resolveUiJobStatus } from "@/composables/main-app/useMainAppQueue.pausing";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const props = defineProps<{
  job: TranscodeJob;
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
  (e: "compare", job: TranscodeJob): void;
  (e: "toggle-select", id: string): void;
  (e: "contextmenu-job", payload: { job: TranscodeJob; event: MouseEvent }): void;
}>();

const { t } = useI18n();

const effectiveProgressStyle = computed<QueueProgressStyle>(() => props.progressStyle ?? "bar");

const clampedProgress = computed(() => {
  const status = props.job.status;

  if (status === "completed" || status === "failed" || status === "skipped" || status === "cancelled") {
    return 100;
  }

  if (status === "processing" || status === "paused") {
    const raw = typeof props.job.progress === "number" ? props.job.progress : 0;
    return Math.max(0, Math.min(100, raw));
  }

  // waiting / queued
  return 0;
});

const progressTransformStyle = computed(() => {
  const pct = clampedProgress.value;
  return { transform: `translateX(-${100 - pct}%)` };
});

const showBarProgress = computed(
  () => props.job.status !== "queued" && props.job.status !== "skipped" && effectiveProgressStyle.value === "bar",
);

const showCardFillProgress = computed(
  () => props.job.status !== "queued" && props.job.status !== "skipped" && effectiveProgressStyle.value === "card-fill",
);

const showRippleCardProgress = computed(
  () =>
    props.job.status !== "queued" && props.job.status !== "skipped" && effectiveProgressStyle.value === "ripple-card",
);

const uiStatus = computed(() => resolveUiJobStatus(props.job));

// 根据任务状态计算进度条颜色类
const progressColorClass = computed(() => {
  switch (uiStatus.value) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "paused":
    case "pausing":
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
  switch (uiStatus.value) {
    case "completed":
      return "bg-gradient-to-r from-emerald-500/60 via-emerald-500 to-emerald-500/60";
    case "failed":
      return "bg-gradient-to-r from-red-500/60 via-red-500 to-red-500/60";
    case "paused":
    case "pausing":
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

const displayStatusKey = computed(() => uiStatus.value);

const statusLabel = computed(() => t(`queue.status.${displayStatusKey.value}`) as string);

const statusBadgeClass = computed(() => {
  switch (uiStatus.value) {
    case "completed":
      return "border-emerald-500/60 text-emerald-200 bg-emerald-500/20";
    case "processing":
      return "border-blue-500/60 text-blue-200 bg-blue-500/20";
    case "paused":
    case "pausing":
    case "queued":
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
const { elapsedTimeDisplay, estimatedTotalTimeDisplay, shouldShowTimeInfo, isTerminalState, isProcessing } =
  useJobTimeDisplay(toRef(props, "job"));

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

const compareDisabledReason = computed(() => {
  if (!hasTauri()) return "requires-tauri";
  return getJobCompareDisabledReason(props.job);
});

const canCompare = computed(() => isJobCompareEligible(props.job) && compareDisabledReason.value == null);

const compareDisabledText = computed(() => {
  const reason = compareDisabledReason.value;
  if (!reason) return null;
  if (reason === "requires-tauri") return t("jobCompare.requiresTauri") as string;
  if (reason === "not-video") return t("jobCompare.disabled.notVideo") as string;
  if (reason === "status") return t("jobCompare.disabled.status") as string;
  if (reason === "no-output") return t("jobCompare.disabled.noOutput") as string;
  if (reason === "no-partial-output") return t("jobCompare.disabled.noPartialOutput") as string;
  return t("jobCompare.disabled.unavailable") as string;
});

const desiredPreviewHeightPx = computed(() => {
  if (props.size === "large") return 720;
  if (props.size === "medium") return 540;
  return 360;
});

const { previewUrl, handlePreviewError } = useQueueItemPreview({
  job: computed(() => props.job),
  isTestEnv,
  desiredHeightPx: desiredPreviewHeightPx,
});

const onInspect = () => {
  emit("inspect", props.job);
};

const onCompare = (event: MouseEvent) => {
  event.stopPropagation();
  emit("compare", props.job);
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

if (isQueuePerfEnabled) {
  onUpdated(() => {
    recordQueueIconItemUpdate();
  });
}
</script>

<template>
  <div
    class="relative rounded-lg border border-border/60 bg-card/80 overflow-hidden hover:border-primary/60 transition-colors cursor-pointer ring-0"
    :class="[
      rootSizeClass,
      isSelectable && isSelected ? 'border-amber-500/80 !ring-2 ring-inset ring-amber-500/80 bg-amber-500/10' : '',
    ]"
    data-testid="queue-icon-item"
    @click="onCardClick"
    @contextmenu.prevent.stop="onCardContextMenu"
  >
    <div class="relative w-full bg-muted/60" :class="thumbnailAspectClass">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt=""
        decoding="async"
        loading="lazy"
        fetchpriority="low"
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
        :class="
          isSelected
            ? 'bg-amber-500 border-amber-500 text-white'
            : 'border-white/60 bg-black/30 hover:border-white hover:bg-black/50'
        "
      >
        <svg v-if="isSelected" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>

    <div class="relative border-t border-border/40 bg-card/80" :class="captionPaddingClass">
      <div class="flex items-center gap-1">
        <p class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" :title="job.filename">
          {{ displayFilename }}
        </p>
        <QueueJobWarnings :warnings="job.warnings" />
      </div>
      <div class="mt-0.5 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
          <span>{{ statusLabel }}</span>
          <span v-if="timeDisplayText" class="font-mono" data-testid="queue-icon-item-time-display">
            {{ timeDisplayText }}
          </span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <Button
            type="button"
            variant="link"
            size="sm"
            class="h-auto p-0 text-[10px]"
            data-testid="queue-icon-item-detail-button"
            @click.stop="onInspect"
          >
            {{ t("jobDetail.title") }}
          </Button>
          <Button
            v-if="job.type === 'video'"
            type="button"
            variant="link"
            size="sm"
            class="h-auto p-0 text-[10px]"
            data-testid="queue-icon-item-compare-button"
            :disabled="!canCompare"
            :title="compareDisabledText || (t('jobCompare.open') as string)"
            @click="onCompare"
          >
            {{ t("jobCompare.open") }}
          </Button>
        </div>
      </div>

      <!-- 底部进度条：根据 progressStyle 切换不同视觉样式，颜色随任务状态变化 -->
      <div
        v-if="showBarProgress || showCardFillProgress || showRippleCardProgress"
        class="mt-1.5 h-1 w-full bg-muted/60 rounded-full overflow-hidden"
        data-testid="queue-icon-item-progress-container"
      >
        <div
          v-if="showBarProgress"
          class="h-full w-full flex-1 rounded-full transition-transform duration-150 ease-linear will-change-transform"
          :class="progressColorClass"
          :style="progressTransformStyle"
          data-testid="queue-icon-item-progress-bar"
        />
        <div
          v-else-if="showCardFillProgress"
          class="h-full w-full flex-1 rounded-full transition-transform duration-150 ease-linear will-change-transform"
          :class="progressColorClass"
          :style="progressTransformStyle"
          data-testid="queue-icon-item-progress-card-fill"
        />
        <div
          v-else
          class="h-full w-full flex-1 rounded-full transition-transform duration-150 ease-linear animate-pulse will-change-transform"
          :class="rippleProgressColorClass"
          :style="progressTransformStyle"
          data-testid="queue-icon-item-progress-ripple-card"
        />
      </div>
    </div>
  </div>
</template>
