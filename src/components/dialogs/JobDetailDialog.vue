<script setup lang="ts">
import { computed, ref } from "vue";
import { useElementSize } from "@vueuse/core";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogScrollContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import { isJobCompareEligible } from "@/lib/jobCompare";
import { useJobDetailDialogState, type JobDetailDialogProps } from "./useJobDetailDialogState";

const props = defineProps<JobDetailDialogProps>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  expandPreview: [];
  compare: [];
  copyCommand: [command: string];
}>();

const { t } = useI18n();

const previewButtonRef = ref<HTMLElement | null>(null);
const { height: previewHeightPx } = useElementSize(previewButtonRef);
const previewDesiredPixels = computed(() => {
  const dpr = typeof window !== "undefined" ? Number(window.devicePixelRatio ?? 1) : 1;
  const height = Math.max(0, Math.floor(previewHeightPx.value));
  if (!Number.isFinite(dpr) || dpr <= 0) return height;
  return Math.max(0, Math.floor(height * dpr));
});

const {
  selectedCommandRun,
  selectedLogRun,
  effectiveRuns,
  inlinePreviewUrl,
  handleInlinePreviewError,
  copyToClipboard,
  statusBadgeClass,
  canCompare,
  compareDisabledText,
  jobFileName,
  jobDetailRawCommand,
  jobDetailEffectiveCommand,
  jobDetailHasDistinctTemplate,
  highlightedCommandTokens,
  jobDetailTemplateCommand,
  toggleCommandView,
  commandViewToggleLabel,
  displayedLogText,
  highlightedLogLines,
  jobStartedAtText,
  jobQueuedAtText,
  jobCompletedAtText,
  jobProcessingSeconds,
  unknownPresetLabel,
} = useJobDetailDialogState(props, (key, params) => (params ? (t(key, params) as string) : (t(key) as string)), {
  desiredPreviewHeightPx: previewDesiredPixels,
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
                  ref="previewButtonRef"
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
                    <div class="text-foreground" data-testid="task-detail-started-at">
                      {{ t("taskDetail.startedAtLabel") }}: {{ jobStartedAtText }}
                    </div>
                    <div v-if="jobQueuedAtText" class="text-foreground" data-testid="task-detail-queued-at">
                      {{ t("taskDetail.queuedAtLabel") }}: {{ jobQueuedAtText }}
                    </div>
                    <div class="text-foreground" data-testid="task-detail-completed-at">
                      {{ t("taskDetail.completedAtLabel") }}: {{ jobCompletedAtText }}
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
                  <Select v-if="effectiveRuns.length > 1" v-model="selectedCommandRun">
                    <SelectTrigger
                      class="h-6 w-[104px] px-2 py-0 text-[10px] bg-muted/40"
                      data-testid="task-detail-command-run-select"
                    >
                      <SelectValue>
                        {{
                          t("taskDetail.runLabel", {
                            n: Number.parseInt(selectedCommandRun, 10) + 1,
                          })
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="(_, idx) in effectiveRuns" :key="idx" :value="String(idx)">
                        {{ t("taskDetail.runLabel", { n: idx + 1 }) }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
                    @click="copyToClipboard(jobDetailEffectiveCommand)"
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
                ><span
                  v-for="(token, idx) in highlightedCommandTokens"
                  :key="idx"
                  :class="token.className"
                  :title="token.title"
                  :data-group="token.group"
                  :data-field="token.field"
                  v-text="token.text"
                ></span></pre>
              </div>
              <p v-else class="text-[11px] text-muted-foreground">
                {{ t("taskDetail.commandFallback") }}
              </p>
            </div>

            <!-- Logs -->
            <div
              v-if="displayedLogText"
              class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
              data-testid="task-detail-log"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <h3 class="text-xs font-semibold">
                    {{ t("taskDetail.logsTitle") }}
                  </h3>
                  <Select v-if="effectiveRuns.length > 1" v-model="selectedLogRun">
                    <SelectTrigger
                      class="h-6 w-[104px] px-2 py-0 text-[10px] bg-muted/40"
                      data-testid="task-detail-log-run-select"
                    >
                      <SelectValue>
                        {{
                          selectedLogRun === "all"
                            ? t("taskDetail.allRuns")
                            : t("taskDetail.runLabel", { n: Number.parseInt(selectedLogRun, 10) + 1 })
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{{ t("taskDetail.allRuns") }}</SelectItem>
                      <SelectItem v-for="(_, idx) in effectiveRuns" :key="idx" :value="String(idx)">
                        {{ t("taskDetail.runLabel", { n: idx + 1 }) }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  class="h-6 px-2 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                  data-testid="task-detail-copy-logs"
                  @click="copyToClipboard(displayedLogText)"
                >
                  {{ t("taskDetail.copyLogs") }}
                </Button>
              </div>
              <div class="rounded-md bg-muted/40 border border-border/60" data-testid="task-detail-log">
                <div
                  class="max-h-64 overflow-y-auto px-2 py-1 text-[11px] font-mono text-foreground whitespace-pre-wrap select-text"
                >
                  <div
                    v-for="(line, lineIdx) in highlightedLogLines"
                    :key="lineIdx"
                    :class="line.className"
                    :title="line.title"
                  >
                    <span
                      v-for="(token, tokenIdx) in line.tokens"
                      :key="tokenIdx"
                      :class="token.className"
                      :title="token.title"
                      :data-group="token.group"
                      :data-field="token.field"
                      v-text="token.text"
                    ></span>
                  </div>
                </div>
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
