<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { FFmpegPreset, QueueProgressStyle, TranscodeJob } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "vue-i18n";
import { buildPreviewUrl, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import { highlightFfmpegCommand, normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";

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
}>();

const isSkipped = computed(() => props.job.status === "skipped");

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
    props.job.status !== "skipped" &&
    props.job.status !== "cancelled",
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

const effectiveProgressStyle = computed<QueueProgressStyle>(
  () => props.progressStyle ?? "bar",
);

// 只保留“真实进度 + 缓动”：后端 progress 是唯一真值，这里只是做一次平滑过渡，
// 不再使用 estimatedSeconds 或任何“高级拟合算法”。缓动时长根据后台汇报间隔
// 动态调整，而不是写死常数。同时，为了和标题栏/任务栏聚合进度保持一致，
// 在显示层面上将 Completed/Failed/Skipped/Cancelled 统一视为 100%，
// Waiting/Queued 视为 0%，Processing/Paused 按实际百分比映射。
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

const displayedProgress = ref(clampedProgress.value);
const displayedClampedProgress = computed(() =>
  Math.max(0, Math.min(100, displayedProgress.value)),
);

// 由父级传入的进度刷新间隔（毫秒）；当缺失时使用一个保守默认值。
const DEFAULT_PROGRESS_INTERVAL_MS = 250;
const effectiveProgressIntervalMs = computed(() => {
  const raw = (props as any).progressUpdateIntervalMs as number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.max(raw, 50), 2000);
  }
  return DEFAULT_PROGRESS_INTERVAL_MS;
});

// 根据后台汇报间隔推导出缓动时长：
// - 汇报间隔非常短（<= 80ms）时：直接关闭缓动，用真实进度即可避免抖动；
// - 中等间隔时：用一个略长于间隔的固定时长（约 160ms）做柔和过渡；
// - 间隔较长时：缓动时长不超过 600ms，避免拖泥带水。
const smoothDurationMs = computed(() => {
  const interval = effectiveProgressIntervalMs.value;
  if (interval <= 80) {
    return 0; // 关闭缓动，直接贴真实进度，靠高汇报率本身保证顺滑。
  }
  if (interval <= 200) {
    return 160;
  }
  return Math.min(interval, 600);
});

let progressAnimationFrame: number | null = null;
let progressAnimStartTime = 0;
let progressAnimStartValue = 0;
let progressAnimTargetValue = 0;

const cancelProgressAnimation = () => {
  if (progressAnimationFrame != null) {
    window.cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = null;
  }
};

const progressAnimationTick = () => {
  progressAnimationFrame = null;

  const now = performance.now();
  const durationMs = smoothDurationMs.value;
  if (durationMs <= 0) {
    // 当前配置下不使用缓动，直接贴合目标值。
    displayedProgress.value = Math.min(100, Math.max(0, progressAnimTargetValue));
    return;
  }
  const elapsed = now - progressAnimStartTime;
  const t = Math.min(1, durationMs > 0 ? elapsed / durationMs : 1);

  // 使用线性插值代替 ease-out-cubic，减少每次采样尾段“减速”的顿挫感，
  // 让进度条在同样时间内以恒定速度贴近后端真实进度。
  const eased = t;
  const next =
    progressAnimStartValue +
    (progressAnimTargetValue - progressAnimStartValue) * eased;

  displayedProgress.value = Math.min(100, Math.max(0, next));

  if (t < 1) {
    progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
  } else {
    displayedProgress.value = progressAnimTargetValue;
  }
};

// 后台一旦上报新进度，只在 processing 状态下做一次固定时长的平滑过渡；
// 非 processing 状态下不在这里动，由状态监听器统一收尾，避免“完成时瞬移”。
watch(
  () => clampedProgress.value,
  (next) => {
    const target = next;

    if (props.job.status !== "processing") {
      return;
    }

    // 变化很小就直接对齐，避免无意义的抖动。
    if (Math.abs(target - displayedProgress.value) < 0.1) {
      displayedProgress.value = target;
      return;
    }

    // 当缓动时长为 0（高汇报率模式）时，直接贴合真实值，不启动动画。
    if (smoothDurationMs.value <= 0) {
      displayedProgress.value = target;
      return;
    }

    cancelProgressAnimation();
    progressAnimStartTime = performance.now();
    progressAnimStartValue = displayedProgress.value;
    progressAnimTargetValue = target;
    progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
  },
  { immediate: true },
);

watch(
  () => props.job.status,
  (status, prevStatus) => {
    if (status === "processing") {
      // 进入 processing 时先对齐一次真实值，后续由进度监听驱动缓动。
      displayedProgress.value = clampedProgress.value;
      return;
    }

    // 离开 processing 状态时，根据前一个状态决定是否做“收尾缓动”。
    cancelProgressAnimation();

    if (
      prevStatus === "processing" &&
      (status === "completed" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "skipped")
    ) {
      const target = clampedProgress.value;
      const start = displayedProgress.value;

      // 差值很小直接贴合，差值较大走一段与后台间隔同级的缓动，避免最后一步瞬移。
      if (Math.abs(target - start) < 0.1) {
        displayedProgress.value = target;
      } else if (smoothDurationMs.value > 0) {
        progressAnimStartTime = performance.now();
        progressAnimStartValue = start;
        progressAnimTargetValue = target;
        progressAnimationFrame = window.requestAnimationFrame(progressAnimationTick);
      } else {
        // 高汇报率且关闭缓动时，直接贴合终点，避免多余抖动。
        displayedProgress.value = target;
      }
    } else {
      // 其它从非 processing → 终态（例如直接跳过的任务），直接对齐真实值即可。
      displayedProgress.value = clampedProgress.value;
    }
  },
);

const showBarProgress = computed(
  () =>
    !isSkipped.value &&
    props.job.status !== "waiting" &&
    effectiveProgressStyle.value === "bar",
);

const showCardFillProgress = computed(
  () =>
    !isSkipped.value &&
    props.job.status !== "waiting" &&
    effectiveProgressStyle.value === "card-fill",
);

const showRippleCardProgress = computed(
  () =>
    !isSkipped.value &&
    props.job.status !== "waiting" &&
    effectiveProgressStyle.value === "ripple-card",
);

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
  return showTemplateCommand.value ? "显示完整命令" : "显示模板视图";
});

const highlightedCommand = computed(() => highlightFfmpegCommand(effectiveCommand.value));

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

onUnmounted(() => {
  cancelProgressAnimation();
});
</script>

<template>
  <Card
    class="relative mb-3 border-border/60 bg-card/80 transition-colors cursor-pointer overflow-hidden"
    :class="[
      isSkipped ? 'opacity-60 bg-muted/60' : 'hover:border-primary/40',
      isSelectable && isSelected
        ? 'border-primary/70 ring-1 ring-primary/60 bg-primary/5'
        : '',
      isCompact ? 'p-2 md:p-2' : 'p-3 md:p-4',
    ]"
    @click="emit('inspect', job)"
  >
    <!-- 卡片级进度视觉：card-fill / ripple-card 使用整个卡片作为进度容器 -->
    <div
      v-if="showCardFillProgress"
      class="absolute inset-0 pointer-events-none"
      data-testid="queue-item-progress-card-fill"
    >
      <!-- 轻微基底遮罩，保证文字在低进度时仍可读 -->
      <div class="absolute inset-0 bg-card/40" />
      <!-- 从左到右逐步“揭开”截图，使整张卡片背景成为进度条 -->
      <div
        class="absolute inset-y-0 left-0 overflow-hidden"
        :style="{ width: `${displayedClampedProgress}%` }"
      >
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          class="h-full w-full object-cover opacity-95"
          @error="handlePreviewError"
        />
        <div
          v-else
          class="h-full w-full bg-gradient-to-r from-card/40 via-card/20 to-card/0"
        />
      </div>
    </div>
    <div
      v-else-if="showRippleCardProgress"
      class="absolute inset-0 pointer-events-none"
      data-testid="queue-item-progress-ripple-card"
    >
      <!-- 水波卡片使用纯色液体，不再叠加截图，避免内容被完全盖住 -->
      <div
        class="absolute inset-y-0 left-0"
        :style="{ width: `${displayedClampedProgress}%` }"
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
    </div>

    <div class="relative flex items-center justify-between mb-2">
      <div class="flex items-center gap-3">
        <Checkbox
          v-if="isSelectable"
          :checked="isSelected"
          data-testid="queue-item-select-toggle"
          class="mr-1 h-4 w-4 rounded-full border-border data-[state=checked]:border-primary/60"
          @click.stop
          @update:checked="() => emit('toggle-select', job.id)"
        />
        <div
          class="h-14 w-24 rounded-md bg-muted overflow-hidden border border-border/60 flex items-center justify-center flex-shrink-0"
          data-testid="queue-item-thumbnail"
          @click.stop="emit('preview', job)"
        >
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt=""
            class="h-full w-full object-cover"
            @error="handlePreviewError"
          />
        </div>
        <span
          class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold"
          :class="{
            'border-emerald-500/60 text-emerald-400 bg-emerald-500/10': job.status === 'completed',
            'border-blue-500/60 text-blue-400 bg-blue-500/10': job.status === 'processing',
            'border-amber-500/60 text-amber-400 bg-amber-500/10':
              job.status === 'waiting' || job.status === 'paused',
            'border-red-500/60 text-red-400 bg-red-500/10': job.status === 'failed',
            'border-muted-foreground/40 text-muted-foreground bg-muted/40': job.status === 'skipped',
          }"
        >
          <span v-if="job.status === 'completed'">✓</span>
          <span v-else-if="job.status === 'failed'">!</span>
          <span v-else-if="job.status === 'processing'">●</span>
          <span v-else-if="job.status === 'waiting'">…</span>
          <span v-else-if="job.status === 'paused'">Ⅱ</span>
          <span v-else-if="job.status === 'skipped'">×</span>
          <span v-else>•</span>
        </span>

        <div>
          <div class="flex items-center gap-2">
            <Badge
              variant="outline"
              class="px-1.5 py-0.5 text-[10px] font-medium"
              :class="job.type === 'image' ? 'border-purple-500/40 text-purple-300' : 'border-blue-500/40 text-blue-300'"
            >
              {{ typeLabel }}
            </Badge>
            <h4
              class="font-medium truncate max-w-xs md:max-w-md"
              :class="isSkipped ? 'text-muted-foreground' : 'text-foreground'"
              :title="job.filename"
            >
              {{ displayFilename }}
            </h4>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
            <span
              v-if="!isSkipped"
              class="bg-muted px-1.5 py-0.5 rounded text-foreground"
            >
              {{ preset.name }}
            </span>
            <span>{{ displayOriginalSize }} MB</span>
            <span
              v-if="job.originalCodec"
              class="uppercase text-muted-foreground border border-border px-1 rounded"
            >
              {{ job.originalCodec }}
            </span>

            <template v-if="job.status === 'completed' && job.outputSizeMB">
              <span>→</span>
              <span class="text-emerald-400 font-bold">
                {{ displayOutputSize }} MB
              </span>
              <span>({{ savedLabel }})</span>
            </template>

            <span
              v-if="isSkipped && job.skipReason"
              class="text-amber-400 italic ml-2"
            >
              {{ t("queue.skippedPrefix") }} {{ job.skipReason }}
            </span>
            <span
              v-if="job.source"
              class="inline-flex items-center px-1.5 py-0.5 rounded border border-border/60 text-[10px] uppercase tracking-wide"
            >
              {{ sourceLabel }}
            </span>
          </div>
        </div>
      </div>

      <div class="text-right flex flex-col items-end gap-1">
        <span class="text-xs font-bold uppercase tracking-wide" :class="statusTextClass">
          {{ localizedStatus }}
        </span>
        <div class="flex flex-wrap justify-end gap-1">
          <Button
            v-if="isWaitable"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="queue-item-wait-button"
            @click.stop="emit('wait', job.id)"
          >
            {{ t("queue.actions.wait") }}
          </Button>
          <Button
            v-if="isResumable"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="queue-item-resume-button"
            @click.stop="emit('resume', job.id)"
          >
            {{ t("queue.actions.resume") }}
          </Button>
          <Button
            v-if="isRestartable"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="queue-item-restart-button"
            @click.stop="emit('restart', job.id)"
          >
            {{ t("queue.actions.restart") }}
          </Button>
          <Button
            v-if="isCancellable"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            @click.stop="emit('cancel', job.id)"
          >
            {{ t("app.actions.cancel") }}
          </Button>
        </div>
      </div>
    </div>

    <Progress
      v-if="showBarProgress"
      :model-value="displayedClampedProgress"
      class="mt-2 relative z-10"
      data-testid="queue-item-progress-bar"
    />
    <div
      v-if="!isCompact && mediaSummary"
      class="mt-2 text-[11px] text-muted-foreground flex flex-wrap gap-2"
    >
      <span class="inline-flex items-center rounded bg-muted px-1.5 py-0.5">
        {{ mediaSummary }}
      </span>
    </div>
    <div v-if="!isCompact && rawCommand" class="mt-2 space-y-1">
      <div class="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{{ t("taskDetail.commandTitle", "命令") }}</span>
        <Button
          v-if="hasDistinctTemplate"
          type="button"
          variant="link"
          size="xs"
          class="text-[10px] px-0"
          @click.stop="toggleCommandView"
        >
          {{ commandViewToggleLabel }}
        </Button>
      </div>
      <pre
        class="max-h-24 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap select-text"
        v-html="highlightedCommand"
      />
    </div>
  </Card>
</template>
