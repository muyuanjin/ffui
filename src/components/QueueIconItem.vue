<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { QueueProgressStyle, TranscodeJob } from "@/types";
import { useI18n } from "vue-i18n";
import { buildPreviewUrl, hasTauri, loadPreviewDataUrl } from "@/lib/backend";

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

// 与列表视图保持一致：内部 queued 状态在文案层统一视为 waiting。
const displayStatusKey = computed(() =>
  props.job.status === "queued" ? "waiting" : props.job.status,
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

const previewUrl = ref<string | null>(null);
const previewFallbackLoaded = ref(false);

watch(
  () => props.job.previewPath,
  (path) => {
    previewFallbackLoaded.value = false;
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
    console.error(
      "QueueIconItem: failed to load preview via data URL fallback",
      error,
    );
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
        <p class="text-[10px] text-muted-foreground truncate">
          {{ statusLabel }}
        </p>
        <button
          type="button"
          class="text-[10px] text-primary hover:underline"
          data-testid="queue-icon-item-detail-button"
          @click.stop="onInspect"
        >
          {{ t("jobDetail.title") }}
        </button>
      </div>

      <!-- 底部进度条：根据 progressStyle 切换不同视觉样式 -->
      <div
        v-if="showBarProgress || showCardFillProgress || showRippleCardProgress"
        class="mt-1.5 h-1 w-full bg-muted/60 rounded-full overflow-hidden"
        data-testid="queue-icon-item-progress-container"
      >
        <div
          v-if="showBarProgress"
          class="h-full rounded-full transition-all duration-300 bg-primary"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-bar"
        />
        <div
          v-else-if="showCardFillProgress"
          class="h-full rounded-full transition-all duration-300 bg-primary"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-card-fill"
        />
        <div
          v-else
          class="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-primary/60 via-primary to-primary/60 animate-pulse"
          :style="{ width: `${clampedProgress}%` }"
          data-testid="queue-icon-item-progress-ripple-card"
        />
      </div>
    </div>
  </div>
</template>
