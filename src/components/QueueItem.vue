<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FFmpegPreset, QueueProgressStyle, TranscodeJob } from "../types";
import { Card } from "@/components/ui/card";
import { Progress, type ProgressVariant } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import { buildPreviewUrl, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import { highlightFfmpegCommand, normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";
import QueueItemProgressLayer from "@/components/queue-item/QueueItemProgressLayer.vue";
import QueueItemHeaderRow from "@/components/queue-item/QueueItemHeaderRow.vue";
import { useSmoothProgress } from "@/components/queue-item/useSmoothProgress";

const props = defineProps<{
  job: TranscodeJob;
  preset: FFmpegPreset;
  canCancel?: boolean;
  canWait?: boolean;
  canResume?: boolean;
  canRestart?: boolean;
  /**
   * When true, render a small selection toggle so the parent queue view can
   * drive bulk actions (pause/wait/restart/cancel) over multiple jobs.
   */
  canSelect?: boolean;
  /**
   * Selection state driven by the parent. The visual checkbox mirrors this
   * flag and emits a `toggle-select` event when clicked.
   */
  selected?: boolean;
  /**
   * Resolved FFmpeg executable path from the backend/tool status. When the
   * command view is switched to "full", this is used to expand a bare
   * `ffmpeg` program token into the concrete executable path so users can
   * copy the exact command that will be executed.
   */
  ffmpegResolvedPath?: string | null;
  /**
   * Visual density for this row. "detail" matches the existing layout,
   * while "compact" uses reduced spacing and hides secondary text.
   */
  viewMode?: "detail" | "compact";
  /**
   * Per-row progress style. The queue chooses this based on the
   * global queueProgressStyle preference.
   */
  progressStyle?: QueueProgressStyle;
  /**
   * Approximate backend progress update interval in milliseconds. This is
   * used to tune the easing duration so the visual progress matches the
   * reporting cadence instead of using a hard-coded constant.
   */
  progressUpdateIntervalMs?: number;
}>();

const emit = defineEmits<{
  (e: "cancel", id: string): void;
  (e: "wait", id: string): void;
  (e: "resume", id: string): void;
  (e: "restart", id: string): void;
  (e: "inspect", job: TranscodeJob): void;
  (e: "preview", job: TranscodeJob): void;
  (e: "toggle-select", id: string): void;
  (e: "contextmenu-job", payload: { job: TranscodeJob; event: MouseEvent }): void;
}>();

const rowVariant = computed<"detail" | "compact">(
  () => props.viewMode ?? "detail",
);
const isCompact = computed(() => rowVariant.value === "compact");

const statusTextClass = computed(() => {
  switch (props.job.status) {
    case "completed":
      return "text-emerald-500";
    case "processing":
      return "text-blue-500";
    case "paused":
      return "text-amber-500";
    case "cancelled":
      return "text-muted-foreground";
    case "skipped":
      return "text-muted-foreground";
    case "waiting":
      return "text-amber-500";
    case "failed":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
});

const { t } = useI18n();

// 将内部 queued 统一映射为 waiting，避免在文案中暴露裸 key。
const displayStatusKey = computed(() =>
  props.job.status === "queued" ? "waiting" : props.job.status,
);

const localizedStatus = computed(() => t(`queue.status.${displayStatusKey.value}`));

const typeLabel = computed(() =>
  props.job.type === "image" ? t("queue.typeImage") : t("queue.typeVideo"),
);

const sourceLabel = computed(() => {
  if (props.job.source === "smart_scan") {
    return t("queue.source.smartScan");
  }
  return t("queue.source.manual");
});

const isCancellable = computed(
  () =>
    props.canCancel &&
    (props.job.status === "waiting" ||
      props.job.status === "queued" ||
      props.job.status === "processing" ||
      props.job.status === "paused"),
);

const isWaitable = computed(
  () => props.canWait && props.job.status === "processing",
);

const isResumable = computed(
  () => props.canResume && props.job.status === "paused",
);

const isRestartable = computed(
  () =>
    props.canRestart &&
    props.job.status !== "completed" &&
    props.job.status !== "skipped",
);

const isSelectable = computed(() => props.canSelect === true);
const isSelected = computed(() => !!props.selected);

const displayFilename = computed(() => {
  const name = props.job.filename;
  if (!name) return "";
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? name.slice(idx + 1) : name;
});

const displayOriginalSize = computed(() => {
  const value = props.job.originalSizeMB;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0.00";
  }
  return value.toFixed(2);
});

const displayOutputSize = computed(() => {
  const value = props.job.outputSizeMB;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0.00";
  }
  return value.toFixed(2);
});

const savedLabel = computed(() => {
  const output = props.job.outputSizeMB;
  const input = props.job.originalSizeMB;
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return "";
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return "";
  const percent = ((1 - output / input) * 100).toFixed(0);
  return t("queue.savedShort", { percent });
});

const {
  isSkipped,
  displayedClampedProgress,
  showBarProgress,
  showCardFillProgress,
  showRippleCardProgress,
} = useSmoothProgress({
  job: computed(() => props.job),
  progressStyle: computed(() => props.progressStyle),
  progressUpdateIntervalMs: computed(() => props.progressUpdateIntervalMs),
});

// 根据任务状态计算进度条颜色变体
const progressVariant = computed<ProgressVariant>(() => {
  switch (props.job.status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
    case "waiting":
    case "queued":
      return "warning";
    case "cancelled":
    case "skipped":
      return "muted";
    case "processing":
    default:
      return "default";
  }
});

const showTemplateCommand = ref(true);

const rawCommand = computed(() => props.job.ffmpegCommand ?? "");

const templateCommand = computed(() => {
  const raw = rawCommand.value;
  if (!raw) return "";
  const result = normalizeFfmpegTemplate(raw);
  return result.template;
});

const effectiveCommand = computed(() => {
  const raw = rawCommand.value;
  const templ = templateCommand.value;
  if (showTemplateCommand.value) {
    return templ || raw;
  }
  return raw;
});

const hasDistinctTemplate = computed(() => {
  const raw = rawCommand.value;
  const templ = templateCommand.value;
  return !!raw && !!templ && templ !== raw;
});

const toggleCommandView = () => {
  if (!hasDistinctTemplate.value) return;
  showTemplateCommand.value = !showTemplateCommand.value;
};

const commandViewToggleLabel = computed(() => {
  if (!hasDistinctTemplate.value) return "";
  return showTemplateCommand.value
    ? (t("taskDetail.commandToggle.showFull") as string)
    : (t("taskDetail.commandToggle.showTemplate") as string);
});

const highlightedCommand = computed(() =>
  highlightFfmpegCommand(effectiveCommand.value, {
    programOverrides: {
      // Only expand to the concrete ffmpeg path in the "full command" view;
      // the template view should keep the normalized `ffmpeg` token.
      ffmpeg: showTemplateCommand.value ? null : props.ffmpegResolvedPath ?? null,
    },
  }),
);

const previewUrl = ref<string | null>(null);
const previewFallbackLoaded = ref(false);

/**
 * 为队列项计算缩略图路径：
 * - 首选后端提供的 previewPath（通常是预生成的 jpg 预览图或 AVIF 输出）；
 * - 对于图片任务，当 previewPath 为空时，回退到 outputPath 或 inputPath，保证
 *   Smart Scan 图片子任务在“替换原文件”后仍然可以预览最终压缩结果；
 * - 视频任务仍然只依赖 previewPath，避免直接用视频文件作为 <img> 源。
 */
watch(
  () => ({
    previewPath: props.job.previewPath,
    type: props.job.type,
    inputPath: props.job.inputPath,
    outputPath: props.job.outputPath,
  }),
  ({ previewPath, type, inputPath, outputPath }) => {
    previewFallbackLoaded.value = false;

    let path: string | null = null;

    if (previewPath) {
      path = previewPath;
    } else if (type === "image") {
      // 图片任务在缺少专用预览图时，使用最终输出或原始输入路径兜底。
      path = outputPath || inputPath || null;
    }

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
    console.error("QueueItem: failed to load preview via data URL fallback", error);
  }
};

const mediaSummary = computed(() => {
  const info = props.job.mediaInfo;
  if (!info) return "";

  const parts: string[] = [];

  const duration = info.durationSeconds;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const totalSeconds = Math.floor(duration);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    parts.push(`${minutes}:${seconds.toString().padStart(2, "0")}`);
  }

  if (typeof info.width === "number" && typeof info.height === "number") {
    parts.push(`${info.width}×${info.height}`);
  }

  const size = info.sizeMB;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    parts.push(`${size.toFixed(2)} MB`);
  }

  if (info.videoCodec) {
    parts.push(info.videoCodec.toUpperCase());
  }

  return parts.join(" • ");
});

const onCardClick = () => {
  if (isSelectable.value) {
    emit("toggle-select", props.job.id);
  } else {
    emit("inspect", props.job);
  }
};

const onCardContextMenu = (event: MouseEvent) => {
  emit("contextmenu-job", { job: props.job, event });
};
</script>

<template>
  <Card
    class="relative mb-3 border-border/60 bg-card/80 transition-all cursor-pointer overflow-hidden ring-0"
    :class="[
      isSkipped ? 'opacity-60 bg-muted/60' : 'hover:border-primary/40',
      isSelectable && isSelected
        ? 'border-primary/70 !ring-1 ring-primary/60 bg-primary/5'
        : '',
      isCompact ? 'p-2 md:p-2' : 'p-3 md:p-4',
    ]"
    data-testid="queue-item-card"
    @click="onCardClick"
    @contextmenu.prevent.stop="onCardContextMenu"
  >
    <QueueItemProgressLayer
      :show-card-fill-progress="showCardFillProgress"
      :show-ripple-card-progress="showRippleCardProgress"
      :preview-url="previewUrl"
      :displayed-clamped-progress="displayedClampedProgress"
      :status="job.status"
      @preview-error="handlePreviewError"
    />

    <QueueItemHeaderRow
      :job="job"
      :preset="preset"
      :is-selectable="isSelectable"
      :is-selected="isSelected"
      :is-skipped="isSkipped"
      :type-label="typeLabel"
      :display-filename="displayFilename"
      :display-original-size="displayOriginalSize"
      :display-output-size="displayOutputSize"
      :saved-label="savedLabel"
      :source-label="sourceLabel"
      :status-text-class="statusTextClass"
      :localized-status="localizedStatus"
      :is-waitable="isWaitable"
      :is-resumable="isResumable"
      :is-restartable="isRestartable"
      :is-cancellable="isCancellable"
      :preview-url="previewUrl"
      :t="t"
      @toggle-select="(id) => emit('toggle-select', id)"
      @inspect="(targetJob) => emit('inspect', targetJob)"
      @wait="(id) => emit('wait', id)"
      @resume="(id) => emit('resume', id)"
      @restart="(id) => emit('restart', id)"
      @cancel="(id) => emit('cancel', id)"
      @preview="(targetJob) => emit('preview', targetJob)"
      @preview-error="handlePreviewError"
    />

    <Progress
      v-if="showBarProgress"
      :model-value="displayedClampedProgress"
      :variant="progressVariant"
      class="mt-2 relative z-10"
      data-testid="queue-item-progress-bar"
    />
    <div
      v-if="!isCompact && (rawCommand || mediaSummary)"
      class="mt-2 space-y-1"
    >
      <div class="flex items-center justify-between text-[11px] text-muted-foreground">
        <span class="flex-shrink-0">{{ t("taskDetail.commandTitle") }}</span>
        <span
          v-if="mediaSummary"
          class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 mx-2"
        >
          {{ mediaSummary }}
        </span>
        <Button
          v-if="hasDistinctTemplate"
          type="button"
          variant="link"
          size="xs"
          class="text-[10px] px-0 flex-shrink-0"
          @click.stop="toggleCommandView"
        >
          {{ commandViewToggleLabel }}
        </Button>
        <span v-else />
      </div>
      <pre
        class="max-h-24 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap select-text"
        v-html="highlightedCommand"
      />
    </div>
  </Card>
</template>
