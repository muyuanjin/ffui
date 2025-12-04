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
}>();

const emit = defineEmits<{
  (e: "inspect", job: TranscodeJob): void;
  (e: "preview", job: TranscodeJob): void;
}>();

const { t } = useI18n();

const effectiveProgressStyle = computed<QueueProgressStyle>(
  () => props.progressStyle ?? "bar",
);

const clampedProgress = computed(() =>
  Math.max(0, Math.min(100, props.job.progress ?? 0)),
);

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

const statusLabel = computed(() =>
  t(`queue.status.${props.job.status}`) as string,
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
</script>

<template>
  <div
    class="relative rounded-lg border border-border/60 bg-card/80 overflow-hidden hover:border-primary/60 transition-colors cursor-pointer"
    :class="rootSizeClass"
    data-testid="queue-icon-item"
    @click="onInspect"
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

    </div>

    <div
      class="relative border-t border-border/40 bg-card/80 overflow-hidden"
      :class="captionPaddingClass"
    >
      <!-- 在网格视图中，进度条通过底部说明区域的背景表现，避免覆盖预览图。 -->
      <div
        v-if="showBarProgress"
        class="absolute inset-y-0 left-0 bg-primary/40"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-item-progress-bar"
      />
      <div
        v-else-if="showCardFillProgress"
        class="absolute inset-y-0 left-0 overflow-hidden"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-item-progress-card-fill"
      >
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          class="h-full w-full object-cover opacity-80"
          @error="handlePreviewError"
        />
        <div
          v-else
          class="h-full w-full bg-gradient-to-r from-card/40 via-card/20 to-card/0"
        />
      </div>
      <div
        v-else-if="showRippleCardProgress"
        class="absolute inset-y-0 left-0"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-item-progress-ripple-card"
      >
        <div
          v-if="job.status === 'processing'"
          class="h-full w-full bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30 opacity-80 animate-pulse"
        />
        <div
          v-else
          class="h-full w-full bg-primary/60"
        />
      </div>

      <p
        class="relative truncate text-[11px] font-medium text-foreground"
        :title="job.filename"
      >
        {{ displayFilename }}
      </p>
      <p class="relative mt-0.5 text-[10px] text-muted-foreground truncate">
        {{ statusLabel }}
      </p>
    </div>
  </div>
</template>
