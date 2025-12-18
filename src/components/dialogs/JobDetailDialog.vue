<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogScrollContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "vue-i18n";
import {
  buildJobPreviewUrl,
  cleanupFallbackPreviewFramesAsync,
  ensureJobPreview,
  hasTauri,
  loadPreviewDataUrl,
} from "@/lib/backend";
import type { TranscodeJob, FFmpegPreset } from "@/types";
import { useFfmpegCommandView } from "@/components/queue-item/useFfmpegCommandView";
import { getJobCompareDisabledReason, isJobCompareEligible } from "@/lib/jobCompare";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const props = defineProps<{
  open: boolean;
  job: TranscodeJob | null;
  preset: FFmpegPreset | null;
  jobDetailLogText: string;
  highlightedLogHtml: string;
  /**
   * Resolved FFmpeg executable path from backend/tool status (if known).
   * Used to expand bare `ffmpeg` program tokens into the concrete path in
   * the "full command" view so users can copy the exact binary invocation.
   */
  ffmpegResolvedPath?: string | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  expandPreview: [];
  compare: [];
  copyCommand: [command: string];
}>();

const { t } = useI18n();

// --- Preview handling ---
const inlinePreviewUrl = ref<string | null>(null);
const inlinePreviewFallbackLoaded = ref(false);
const inlinePreviewRescreenshotAttempted = ref(false);

watch(
  () => props.open,
  (open, prev) => {
    if (prev && !open && hasTauri()) {
      void cleanupFallbackPreviewFramesAsync();
    }
  },
);

watch(
  () => ({ previewPath: props.job?.previewPath, previewRevision: props.job?.previewRevision }),
  ({ previewPath, previewRevision }) => {
    inlinePreviewFallbackLoaded.value = false;
    inlinePreviewRescreenshotAttempted.value = false;
    if (!previewPath) {
      inlinePreviewUrl.value = null;
      return;
    }
    inlinePreviewUrl.value = buildJobPreviewUrl(previewPath, previewRevision);
  },
  { immediate: true },
);

const handleInlinePreviewError = async () => {
  const path = props.job?.previewPath;
  if (!path) return;
  if (!hasTauri()) return;
  if (inlinePreviewFallbackLoaded.value) return;

  try {
    inlinePreviewUrl.value = await loadPreviewDataUrl(path);
    inlinePreviewFallbackLoaded.value = true;
  } catch (error) {
    if (inlinePreviewRescreenshotAttempted.value || !props.job) {
      console.error("JobDetailDialog: failed to load inline preview via data URL fallback", error);
      return;
    }

    inlinePreviewRescreenshotAttempted.value = true;
    if (!isTestEnv) {
      console.warn("JobDetailDialog: preview missing or unreadable, attempting regeneration", error);
    }

    try {
      const regenerated = await ensureJobPreview(props.job.id);
      if (regenerated) {
        inlinePreviewUrl.value = buildJobPreviewUrl(regenerated, props.job.previewRevision);
        inlinePreviewFallbackLoaded.value = false;
      }
    } catch (regenError) {
      console.error("JobDetailDialog: failed to regenerate preview", regenError);
    }
  }
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

// --- Derived data ---
const statusBadgeClass = computed(() => {
  if (!props.job) return "";
  const status = props.job.status;
  if (status === "completed") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
  if (status === "processing") return "bg-blue-500/20 text-blue-400 border-blue-500/40";
  if (status === "failed") return "bg-destructive/20 text-destructive border-destructive/40";
  if (status === "cancelled") return "bg-orange-500/20 text-orange-400 border-orange-500/40";
  if (status === "waiting" || status === "queued") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  if (status === "paused") return "bg-purple-500/20 text-purple-400 border-purple-500/40";
  if (status === "skipped") return "bg-gray-500/20 text-gray-400 border-gray-500/40";
  return "bg-muted text-muted-foreground border-border";
});

const compareDisabledReason = computed(() => getJobCompareDisabledReason(props.job));
const canCompare = computed(() => isJobCompareEligible(props.job) && compareDisabledReason.value == null);
const compareDisabledText = computed(() => {
  const reason = compareDisabledReason.value;
  if (!reason) return null;
  if (reason === "not-video") return t("jobCompare.disabled.notVideo") as string;
  if (reason === "status") return t("jobCompare.disabled.status") as string;
  if (reason === "no-output") return t("jobCompare.disabled.noOutput") as string;
  if (reason === "no-partial-output") return t("jobCompare.disabled.noPartialOutput") as string;
  return t("jobCompare.disabled.unavailable") as string;
});

const jobFileName = computed(() => {
  const path = props.job?.filename || "";
  if (!path) return "";
  const normalised = path.replace(/\\/g, "/");
  const idx = normalised.lastIndexOf("/");
  return idx >= 0 ? normalised.slice(idx + 1) : normalised;
});

const jobDetailRawCommand = computed(() => props.job?.ffmpegCommand ?? "");
const {
  effectiveCommand: jobDetailEffectiveCommand,
  hasDistinctTemplate: jobDetailHasDistinctTemplate,
  highlightedHtml: highlightedCommandHtml,
  templateCommand: jobDetailTemplateCommand,
  toggle: toggleCommandView,
  toggleLabel: commandViewToggleLabel,
} = useFfmpegCommandView({
  jobId: computed(() => props.job?.id),
  status: computed(() => props.job?.status),
  rawCommand: jobDetailRawCommand,
  ffmpegResolvedPath: computed(() => props.ffmpegResolvedPath),
  t: (key) => t(key) as string,
});

const jobDetailLogText = computed(() => props.jobDetailLogText || "");

// 任务耗时（秒）：优先使用后端累计的 elapsedMs（仅统计实际处理时间），
// 若缺失则退回到 startTime/endTime 差值（近似总耗时），并在处理中时用当前时间估算。
const jobProcessingSeconds = computed(() => {
  const job = props.job;
  if (!job) return null;

  // 1) 优先采用后端提供的累计处理时间（毫秒）
  if (job.elapsedMs != null && job.elapsedMs > 0 && Number.isFinite(job.elapsedMs)) {
    return job.elapsedMs / 1000;
  }

  // 2) 回退到基于开始/结束时间的近似值（优先使用 processingStartedMs）
  const fallbackStart = job.processingStartedMs ?? job.startTime;
  if (!fallbackStart) return null;
  const endMs = job.endTime ?? Date.now();
  if (endMs <= fallbackStart) return null;
  return (endMs - fallbackStart) / 1000;
});

const unknownPresetLabel = computed(() => {
  const id = props.job?.presetId;
  if (!id) return "";
  const translated = t("taskDetail.unknownPreset", { id }) as string;
  if (translated && translated !== "taskDetail.unknownPreset") return translated;
  return `Unknown preset (${id})`;
});
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogScrollContent class="sm:max-w-3xl overflow-hidden p-0">
      <div class="flex max-h-[calc(100vh-4rem)] flex-col">
        <DialogHeader class="border-b border-border px-6 py-4 bg-card">
          <DialogTitle class="text-base">
            {{ t("taskDetail.title") }}
          </DialogTitle>
          <DialogDescription class="mt-1 text-[11px] text-muted-foreground">
            {{ t("taskDetail.description") }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex-1 bg-muted/30 px-6 py-4 text-xs overflow-y-auto">
          <div v-if="job" class="space-y-4">
            <!-- Header -->
            <div
              class="relative overflow-hidden rounded-md border border-border bg-background"
              data-testid="task-detail-header"
            >
              <div
                v-if="inlinePreviewUrl"
                class="pointer-events-none absolute inset-0"
                data-testid="task-detail-header-bg"
              >
                <img
                  :src="inlinePreviewUrl"
                  alt=""
                  class="h-full w-full object-cover blur-sm scale-105"
                  @error="handleInlinePreviewError"
                />
                <div class="absolute inset-0 bg-background/70" />
              </div>

              <div class="relative flex flex-col gap-4 px-3 py-3 md:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="group w-full md:w-60 h-auto aspect-video p-0 rounded-md border border-border bg-muted flex items-center justify-center overflow-hidden cursor-zoom-in hover:bg-muted"
                  data-testid="task-detail-preview"
                  @click.stop="emit('expandPreview')"
                >
                  <img
                    v-if="inlinePreviewUrl"
                    :src="inlinePreviewUrl"
                    alt=""
                    class="h-full w-full object-cover transition-transform group-hover:scale-105"
                    @error="handleInlinePreviewError"
                  />
                  <span v-else class="text-[11px] text-muted-foreground">
                    {{ t("taskDetail.noPreview") }}
                  </span>
                </Button>

                <div class="flex items-center gap-2">
                  <Button
                    v-if="isJobCompareEligible(job)"
                    size="xs"
                    class="h-7 px-3"
                    :disabled="!canCompare"
                    :title="compareDisabledText || undefined"
                    data-testid="task-detail-compare"
                    @click.stop="emit('compare')"
                  >
                    {{ t("jobCompare.open") }}
                  </Button>
                </div>

                <div class="flex-1 space-y-2">
                  <div data-testid="task-detail-title" class="text-sm font-semibold text-foreground break-all">
                    {{ jobFileName || t("jobDetail.title") }}
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" class="text-[10px] uppercase" :class="statusBadgeClass">
                      {{ t(`queue.status.${job.status}`) }}
                    </Badge>
                    <span class="text-[11px] text-muted-foreground">
                      {{ job.source === "batch_compress" ? t("queue.source.batchCompress") : t("queue.source.manual") }}
                    </span>
                  </div>
                  <div class="space-y-1 text-[11px]">
                    <div v-if="preset?.name" class="text-foreground">
                      {{ t("taskDetail.presetLabel") }}:
                      <span class="font-medium">{{ preset.name }}</span>
                      <span v-if="preset.description" class="ml-1 text-muted-foreground"
                        >— {{ preset.description }}</span
                      >
                    </div>
                    <div v-else-if="job.presetId" class="text-foreground">
                      {{ t("taskDetail.presetLabel") }}:
                      <span class="font-medium">
                        {{ unknownPresetLabel }}
                      </span>
                    </div>
                    <div
                      v-if="jobProcessingSeconds != null"
                      class="text-foreground"
                      data-testid="task-detail-processing-time"
                    >
                      {{ t("taskDetail.durationLabel") }}: {{ jobProcessingSeconds.toFixed(1) }} s
                    </div>
                    <div v-if="job.originalSizeMB" class="text-foreground">
                      {{ t("taskDetail.sizeLabel") }}: {{ job.originalSizeMB.toFixed(2) }} MB
                    </div>
                    <div v-if="job.outputSizeMB" class="text-foreground">
                      {{ t("taskDetail.outputSizeLabel") }}: {{ job.outputSizeMB.toFixed(2) }} MB
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Paths & Media Info -->
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                <h3 class="text-xs font-semibold">
                  {{ t("taskDetail.pathsTitle") }}
                </h3>
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="shrink-0 text-[11px] text-muted-foreground"> {{ t("taskDetail.inputPath") }}: </span>
                    <span data-testid="task-detail-input-path" class="flex-1 break-all text-foreground select-text">
                      {{ job.inputPath || job.filename }}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      class="h-6 w-6 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                      @click="copyToClipboard(job.inputPath || job.filename)"
                    >
                      ⧉
                    </Button>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="shrink-0 text-[11px] text-muted-foreground"> {{ t("taskDetail.outputPath") }}: </span>
                    <span data-testid="task-detail-output-path" class="flex-1 break-all text-foreground select-text">
                      {{ job.outputPath || "-" }}
                    </span>
                    <Button
                      v-if="job.outputPath"
                      variant="outline"
                      size="icon-sm"
                      class="h-6 w-6 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                      @click="copyToClipboard(job.outputPath)"
                    >
                      ⧉
                    </Button>
                  </div>
                </div>
              </div>

              <div class="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                <h3 class="text-xs font-semibold">
                  {{ t("taskDetail.mediaInfoTitle") }}
                </h3>
                <div v-if="job.mediaInfo" class="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span class="text-[11px] text-muted-foreground">
                    {{ t("taskDetail.codecLabel") }}
                  </span>
                  <span class="text-foreground">
                    {{ job.mediaInfo?.videoCodec || job.originalCodec || "-" }}
                  </span>
                  <span class="text-[11px] text-muted-foreground">
                    {{ t("taskDetail.resolutionLabel") }}
                  </span>
                  <span class="text-foreground">
                    {{
                      job.mediaInfo?.width && job.mediaInfo?.height
                        ? `${job.mediaInfo.width}×${job.mediaInfo.height}`
                        : "-"
                    }}
                  </span>
                  <span class="text-[11px] text-muted-foreground">
                    {{ t("taskDetail.frameRateLabel") }}
                  </span>
                  <span class="text-foreground">
                    {{ job.mediaInfo?.frameRate ? `${job.mediaInfo.frameRate.toFixed(2)} fps` : "-" }}
                  </span>
                </div>
                <div v-else class="text-[11px] text-muted-foreground">
                  {{ t("taskDetail.mediaInfoFallback") }}
                </div>
              </div>
            </div>

            <!-- Command -->
            <div class="space-y-2 rounded-md border border-border bg-background px-3 py-3">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <h3 class="text-xs font-semibold">
                    {{ t("taskDetail.commandTitle") }}
                  </h3>
                  <Button
                    v-if="jobDetailHasDistinctTemplate"
                    type="button"
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                    @click="toggleCommandView"
                  >
                    {{ commandViewToggleLabel }}
                  </Button>
                </div>
                <div class="flex items-center gap-1">
                  <Button
                    v-if="jobDetailRawCommand"
                    variant="outline"
                    size="xs"
                    class="h-6 px-2 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                    data-testid="task-detail-copy-command"
                    @click="copyToClipboard(jobDetailRawCommand)"
                  >
                    {{ t("taskDetail.copyCommand") }}
                  </Button>
                  <Button
                    v-if="jobDetailHasDistinctTemplate && jobDetailTemplateCommand"
                    variant="outline"
                    size="xs"
                    class="h-6 px-2 text-[10px] bg-secondary/40 text-foreground hover:bg-secondary"
                    data-testid="task-detail-copy-template-command"
                    @click="copyToClipboard(jobDetailTemplateCommand)"
                  >
                    {{ t("taskDetail.copyTemplateCommand") }}
                  </Button>
                </div>
              </div>
              <p class="text-[10px] text-muted-foreground">
                {{ t("taskDetail.commandHint") }}
              </p>
              <div v-if="jobDetailEffectiveCommand" data-testid="task-detail-command">
                <pre
                  class="max-h-32 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-foreground whitespace-pre-wrap select-text"
                  v-html="highlightedCommandHtml"
                />
              </div>
              <p v-else class="text-[11px] text-muted-foreground">
                {{ t("taskDetail.commandFallback") }}
              </p>
            </div>

            <!-- Logs -->
            <div
              v-if="jobDetailLogText"
              class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
              data-testid="task-detail-log"
            >
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-xs font-semibold">
                  {{ t("taskDetail.logsTitle") }}
                </h3>
                <Button
                  variant="outline"
                  size="xs"
                  class="h-6 px-2 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                  data-testid="task-detail-copy-logs"
                  @click="copyToClipboard(jobDetailLogText)"
                >
                  {{ t("taskDetail.copyLogs") }}
                </Button>
              </div>
              <div class="rounded-md bg-muted/40 border border-border/60" data-testid="task-detail-log">
                <pre
                  class="max-h-64 overflow-y-auto px-2 py-1 text-[11px] font-mono text-foreground whitespace-pre-wrap select-text"
                  v-html="highlightedLogHtml"
                />
              </div>
              <p v-if="job.status === 'failed' && job.failureReason" class="text-[11px] text-destructive font-medium">
                {{ t("taskDetail.failureReasonPrefix") }} {{ job.failureReason }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
