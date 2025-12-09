<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress, type ProgressVariant } from "@/components/ui/progress";
import { useI18n } from "vue-i18n";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob, QueueProgressStyle } from "@/types";

const QueueItem = defineAsyncComponent(() => import("@/components/QueueItem.vue"));

defineProps<{
  batch: CompositeSmartScanTask;
  presets: FFmpegPreset[];
  ffmpegResolvedPath?: string | null;
  queueRowVariant: "detail" | "compact";
  queueProgressStyle: QueueProgressStyle;
  progressUpdateIntervalMs: number;
  selectedJobIds: Set<string>;
  isExpanded: boolean;
  canCancelJob: (job: TranscodeJob) => boolean;
}>();

const emit = defineEmits<{
  toggleBatchExpanded: [batchId: string];
  cancelJob: [jobId: string];
  waitJob: [jobId: string];
  resumeJob: [jobId: string];
  restartJob: [jobId: string];
  toggleJobSelected: [jobId: string];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  openJobContextMenu: [payload: { job: TranscodeJob; event: MouseEvent }];
  contextmenuBatch: [payload: { batch: CompositeSmartScanTask; event: MouseEvent }];
}>();

const { t } = useI18n();

/** 计算批次整体进度条颜色 */
const getBatchProgressVariant = (batch: CompositeSmartScanTask): ProgressVariant => {
  const { completedCount, failedCount, cancelledCount, totalCount, jobs } = batch;
  const hasProcessing = jobs.some((j) => j.status === "processing");
  const hasPaused = jobs.some((j) => j.status === "paused" || j.status === "waiting" || j.status === "queued");

  if (completedCount === totalCount && totalCount > 0) return "success";
  if (failedCount > 0) return "error";
  if (cancelledCount > 0 && !hasProcessing) return "muted";
  if (hasPaused && !hasProcessing) return "warning";
  return "default";
};
</script>

<template>
  <Card
    data-testid="smart-scan-batch-card"
    class="border-border/70 bg-card/90 shadow-sm hover:border-primary/40 transition-colors"
    @contextmenu.prevent.stop="emit('contextmenuBatch', { batch, event: $event })"
  >
    <CardHeader class="pb-2 flex flex-row items-start justify-between gap-3 cursor-pointer" @click="emit('toggleBatchExpanded', batch.batchId)">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300">
            {{ t("queue.source.smartScan") }}
          </Badge>
          <span class="text-xs text-muted-foreground">
            {{ batch.totalProcessed }} / {{ batch.totalCandidates }}
          </span>
        </div>
        <CardTitle class="text-sm font-semibold truncate max-w-lg">
          {{ batch.rootPath || t("smartScan.title") }}
        </CardTitle>
        <CardDescription class="text-xs text-muted-foreground">
          <span v-if="batch.currentJob">{{ batch.currentJob.filename }}</span>
          <span v-else>{{ t("smartScan.subtitle") }}</span>
        </CardDescription>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="text-xs font-mono text-muted-foreground">{{ Math.round(batch.overallProgress) }}%</span>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-6 w-6 rounded-full border-border/60 bg-muted/40 text-xs"
          @click.stop="emit('toggleBatchExpanded', batch.batchId)"
        >
          <span v-if="isExpanded">−</span>
          <span v-else>＋</span>
        </Button>
      </div>
    </CardHeader>
    <CardContent class="pt-0 pb-3 space-y-2">
      <Progress :model-value="batch.overallProgress" :variant="getBatchProgressVariant(batch)" />
      <div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span>{{ t("queue.typeVideo") }} / {{ t("queue.typeImage") }}: {{ batch.jobs.filter((j) => j.type === "video").length }} / {{ batch.jobs.filter((j) => j.type === "image").length }}</span>
        <span>{{ t("queue.status.completed") }}: {{ batch.completedCount }}</span>
        <span v-if="batch.skippedCount > 0">{{ t("queue.status.skipped") }}: {{ batch.skippedCount }}</span>
        <span v-if="batch.failedCount > 0">{{ t("queue.status.failed") }}: {{ batch.failedCount }}</span>
      </div>
      <div v-if="isExpanded" data-testid="smart-scan-batch-children" class="mt-2 space-y-2">
        <QueueItem
          v-for="child in batch.jobs.filter((j) => j.status !== 'skipped')"
          :key="child.id"
          :job="child"
          :preset="presets.find((p) => p.id === child.presetId) ?? presets[0]"
          :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
          :can-cancel="canCancelJob(child)"
          :can-restart="true"
          :can-select="true"
          :selected="selectedJobIds.has(child.id)"
          :view-mode="queueRowVariant"
          :progress-style="queueProgressStyle"
          :progress-update-interval-ms="progressUpdateIntervalMs"
          @cancel="emit('cancelJob', $event)"
          @wait="emit('waitJob', $event)"
          @resume="emit('resumeJob', $event)"
          @restart="emit('restartJob', $event)"
          @toggle-select="emit('toggleJobSelected', $event)"
          @inspect="emit('inspectJob', $event)"
          @preview="emit('previewJob', $event)"
          @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
        />
      </div>
    </CardContent>
  </Card>
</template>
