<script setup lang="ts">
import { computed, onUpdated } from "vue";
import type { FFmpegPreset, QueueProgressStyle, TranscodeJob } from "../types";
import { Card } from "@/components/ui/card";
import { Progress, type ProgressVariant } from "@/components/ui/progress";
import { useI18n } from "vue-i18n";
import QueueItemProgressLayer from "@/components/queue-item/QueueItemProgressLayer.vue";
import QueueItemHeaderRow from "@/components/queue-item/QueueItemHeaderRow.vue";
import QueueItemMiniRow from "@/components/queue-item/QueueItemMiniRow.vue";
import QueueItemCommandPreview from "@/components/queue-item/QueueItemCommandPreview.vue";
import { useSmoothProgress } from "@/components/queue-item/useSmoothProgress";
import { useFfmpegCommandView } from "@/components/queue-item/useFfmpegCommandView";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { isQueuePerfEnabled, recordQueueItemUpdate } from "@/lib/queuePerf";
import { useQueueItemPreview } from "@/components/queue-item/useQueueItemPreview";
import { resolveUiJobStatus, type UiJobStatus } from "@/composables/main-app/useMainAppQueue.pausing";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

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
  viewMode?: "detail" | "compact" | "mini";
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
  (e: "compare", job: TranscodeJob): void;
  (e: "toggle-select", id: string): void;
  (e: "contextmenu-job", payload: { job: TranscodeJob; event: MouseEvent }): void;
}>();

const rowVariant = computed<"detail" | "compact" | "mini">(() => props.viewMode ?? "detail");
const isCompact = computed(() => rowVariant.value === "compact");
const isMini = computed(() => rowVariant.value === "mini");
const effectiveStatus = computed<UiJobStatus>(() => resolveUiJobStatus(props.job));
const isPausing = computed(() => effectiveStatus.value === "pausing");

const statusTextClass = computed(() => {
  switch (effectiveStatus.value) {
    case "completed":
      return "text-emerald-500";
    case "processing":
      return "text-blue-500";
    case "pausing":
    case "paused":
      return "text-amber-500";
    case "cancelled":
      return "text-muted-foreground";
    case "skipped":
      return "text-muted-foreground";
    case "queued":
      return "text-amber-500";
    case "failed":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
});

const { t } = useI18n();
const localizedStatus = computed(() => t(`queue.status.${effectiveStatus.value}`));

const typeLabel = computed(() => {
  if (props.job.type === "image") {
    return t("queue.typeImage");
  }
  if (props.job.type === "audio") {
    return t("queue.typeAudio");
  }
  return t("queue.typeVideo");
});

const sourceLabel = computed(() => {
  if (props.job.source === "batch_compress") {
    return t("queue.source.batchCompress");
  }
  return t("queue.source.manual");
});

const isCancellable = computed(
  () =>
    props.canCancel &&
    (props.job.status === "queued" || props.job.status === "processing" || props.job.status === "paused"),
);

const isWaitable = computed(() => props.canWait && props.job.status === "processing" && !isPausing.value);

const isResumable = computed(() => props.canResume && props.job.status === "paused");

const isRestartable = computed(
  () => props.canRestart && props.job.status !== "completed" && props.job.status !== "skipped",
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
  if (output <= input) {
    // 体积缩小或不变，显示"节省 X%"
    const percent = ((1 - output / input) * 100).toFixed(0);
    return t("queue.savedShort", { percent });
  } else {
    // 体积增大，显示"增大 X%"
    const percent = ((output / input - 1) * 100).toFixed(0);
    return t("queue.increasedShort", { percent });
  }
});

// 判断转码后体积变化程度：'decreased' 缩小, 'slight' 轻微增大(<100%), 'severe' 翻倍增大(≥100%)
const sizeChangeLevel = computed<"decreased" | "slight" | "severe">(() => {
  const output = props.job.outputSizeMB;
  const input = props.job.originalSizeMB;
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return "decreased";
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return "decreased";
  if (output <= input) return "decreased";
  const increaseRatio = (output - input) / input;
  return increaseRatio >= 1 ? "severe" : "slight";
});

const {
  isSkipped,
  displayedClampedProgress,
  progressTransitionMs,
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
  switch (effectiveStatus.value) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
    case "pausing":
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

const rawCommand = computed(() => props.job.ffmpegCommand ?? "");
const {
  effectiveCommand,
  hasDistinctTemplate,
  highlightedTokens: highlightedCommandTokens,
  toggle: toggleCommandView,
  toggleLabel: commandViewToggleLabel,
} = useFfmpegCommandView({
  jobId: computed(() => props.job.id),
  status: computed(() => props.job.status),
  rawCommand,
  ffmpegResolvedPath: computed(() => props.ffmpegResolvedPath),
  t: (key) => t(key) as string,
  // Queue cards should default to template view so the user always sees the
  // "Show full command" entry point when available.
  defaultMode: "template",
});

const handleCopyCommand = async () => {
  await copyToClipboard(effectiveCommand.value);
};

const desiredPreviewHeightPx = computed(() => (isMini.value ? 120 : 180));

const { previewUrl, handlePreviewError } = useQueueItemPreview({
  job: computed(() => props.job),
  isTestEnv,
  desiredHeightPx: desiredPreviewHeightPx,
});

const rowListeners = {
  "toggle-select": (id: string) => emit("toggle-select", id),
  inspect: (targetJob: TranscodeJob) => emit("inspect", targetJob),
  compare: (targetJob: TranscodeJob) => emit("compare", targetJob),
  wait: (id: string) => emit("wait", id),
  resume: (id: string) => emit("resume", id),
  restart: (id: string) => emit("restart", id),
  cancel: (id: string) => emit("cancel", id),
  preview: (targetJob: TranscodeJob) => emit("preview", targetJob),
  "preview-error": handlePreviewError,
} as const;

const mediaSummary = computed(() => {
  const info = props.job.mediaInfo;
  if (!info) return "";

  const parts: string[] = [];

  const duration = info.durationSeconds;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const totalSeconds = Math.floor(duration);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const time = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    parts.push(t("queue.media.duration", { time }));
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

if (isQueuePerfEnabled) {
  onUpdated(() => {
    recordQueueItemUpdate();
  });
}
</script>

<template>
  <Card
    class="relative border-border/60 bg-card/80 transition-colors cursor-pointer overflow-hidden ring-0"
    :class="[
      isMini
        ? 'border-0 border-b rounded-none shadow-none bg-transparent'
        : isSkipped
          ? 'opacity-60 bg-muted/60'
          : 'hover:border-primary/40',
      isMini && !isSkipped ? 'hover:bg-muted/20' : '',
      isMini
        ? isSelectable && isSelected
          ? '!ring-2 ring-inset ring-primary/80 bg-primary/20'
          : ''
        : isSelectable && isSelected
          ? 'border-primary/80 !ring-2 ring-inset ring-primary/80 bg-primary/10'
          : '',
      isMini ? 'px-2 py-1.5 md:px-2 md:py-1.5' : isCompact ? 'p-2 md:p-2' : 'p-3 md:p-4',
    ]"
    data-testid="queue-item-card"
    @click="onCardClick"
    @contextmenu.prevent.stop="onCardContextMenu"
  >
    <QueueItemProgressLayer
      v-if="!isMini"
      :show-card-fill-progress="showCardFillProgress"
      :show-ripple-card-progress="showRippleCardProgress"
      :preview-url="previewUrl"
      :displayed-clamped-progress="displayedClampedProgress"
      :transition-ms="progressTransitionMs"
      :status="job.status"
      @preview-error="handlePreviewError"
    />

    <QueueItemMiniRow
      v-if="isMini"
      :job="job"
      :preset="preset"
      :is-selectable="isSelectable"
      :is-selected="isSelected"
      :is-skipped="isSkipped"
      :type-label="typeLabel"
      :display-filename="displayFilename"
      :display-original-size="displayOriginalSize"
      :status-text-class="statusTextClass"
      :localized-status="localizedStatus"
      :is-waitable="isWaitable"
      :is-resumable="isResumable"
      :is-restartable="isRestartable"
      :is-cancellable="isCancellable"
      :preview-url="previewUrl"
      :progress-value="displayedClampedProgress"
      :progress-variant="progressVariant"
      :t="t"
      v-on="rowListeners"
    />

    <QueueItemHeaderRow
      v-else
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
      :size-change-level="sizeChangeLevel"
      :source-label="sourceLabel"
      :status-text-class="statusTextClass"
      :localized-status="localizedStatus"
      :is-waitable="isWaitable"
      :is-resumable="isResumable"
      :is-restartable="isRestartable"
      :is-cancellable="isCancellable"
      :preview-url="previewUrl"
      :t="t"
      v-on="rowListeners"
    />

    <Progress
      v-if="!isMini && showBarProgress"
      :model-value="displayedClampedProgress"
      :variant="progressVariant"
      :transition-ms="progressTransitionMs"
      class="mt-2 relative z-10"
      data-testid="queue-item-progress-bar"
    />
    <div v-if="!isCompact && !isMini && (rawCommand || mediaSummary)">
      <QueueItemCommandPreview
        :raw-command="rawCommand"
        :media-summary="mediaSummary"
        :has-distinct-template="hasDistinctTemplate"
        :command-title="t('taskDetail.commandTitle') as string"
        :copy-title="t('taskDetail.copyCommand') as string"
        :toggle-label="commandViewToggleLabel"
        :highlighted-tokens="highlightedCommandTokens"
        @copy="handleCopyCommand"
        @toggle="toggleCommandView"
      />
    </div>
  </Card>
</template>
