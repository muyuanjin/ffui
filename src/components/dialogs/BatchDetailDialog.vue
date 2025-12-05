<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "vue-i18n";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob, QueueProgressStyle } from "@/types";

const QueueItem = defineAsyncComponent(() => import("@/components/QueueItem.vue"));

const props = defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The batch to display */
  batch: CompositeSmartScanTask | null;
  /** Available presets */
  presets: FFmpegPreset[];
  /** Progress style */
  progressStyle: QueueProgressStyle;
  /** Progress update interval */
  progressUpdateIntervalMs: number;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  cancelJob: [jobId: string];
}>();

const { t } = useI18n();

const formatBytes = (mb: number | null | undefined): string => {
  if (mb == null || mb <= 0) return "-";
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const totalInputSize = computed(() => {
  if (!props.batch) return 0;
  return props.batch.jobs.reduce((sum, job) => sum + (job.originalSizeMB ?? 0), 0);
});

const totalOutputSize = computed(() => {
  if (!props.batch) return 0;
  return props.batch.jobs.reduce((sum, job) => sum + (job.outputSizeMB ?? 0), 0);
});

const compressionRatio = computed(() => {
  if (totalInputSize.value <= 0 || totalOutputSize.value <= 0) return null;
  return ((1 - totalOutputSize.value / totalInputSize.value) * 100).toFixed(1);
});

const getPresetForJob = (job: TranscodeJob): FFmpegPreset => {
  const preset = props.presets.find((p) => p.id === job.presetId);
  if (preset) return preset;
  // Return first preset as fallback, or create a minimal default
  if (props.presets.length > 0) return props.presets[0];
  // Minimal fallback preset if no presets exist
  return {
    id: "default",
    name: "Default",
    description: "",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
    audio: { codec: "copy" },
    filters: {},
    stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  };
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-4xl max-h-[90vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-3">
          <Badge variant="outline" class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300">
            {{ t("queue.source.smartScan") }}
          </Badge>
          <span class="truncate max-w-md">{{ batch?.rootPath || t("smartScan.title") }}</span>
        </DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          {{ batch ? `${batch.totalProcessed} / ${batch.totalCandidates} ${t("smartScan.subtitle")}` : "" }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="batch" class="space-y-4">
        <!-- Progress -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ t("jobDetail.progress") }}</span>
            <span class="font-mono">{{ Math.round(batch.overallProgress) }}%</span>
          </div>
          <Progress :model-value="batch.overallProgress" />
        </div>

        <!-- Statistics -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div class="rounded-md border border-border/60 bg-muted/30 p-2">
            <span class="block text-muted-foreground mb-1">{{ t("queue.status.completed") }}</span>
            <span class="text-lg font-semibold text-emerald-400">{{ batch.completedCount }}</span>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/30 p-2">
            <span class="block text-muted-foreground mb-1">{{ t("queue.status.processing") }}</span>
            <span class="text-lg font-semibold text-blue-400">{{ batch.jobs.filter((j) => j.status === "processing").length }}</span>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/30 p-2">
            <span class="block text-muted-foreground mb-1">{{ t("queue.status.waiting") }}</span>
            <span class="text-lg font-semibold text-yellow-400">{{ batch.jobs.filter((j) => j.status === "waiting" || j.status === "queued").length }}</span>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/30 p-2">
            <span class="block text-muted-foreground mb-1">{{ t("queue.status.failed") }}</span>
            <span class="text-lg font-semibold text-destructive">{{ batch.failedCount }}</span>
          </div>
        </div>

        <!-- Size info -->
        <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>{{ t("jobDetail.inputInfo") }}: {{ formatBytes(totalInputSize) }}</span>
          <span>{{ t("jobDetail.outputInfo") }}: {{ formatBytes(totalOutputSize) }}</span>
          <span v-if="compressionRatio">{{ t("jobDetail.ratio") }}: {{ compressionRatio }}%</span>
          <span>{{ t("queue.typeVideo") }}: {{ batch.jobs.filter((j) => j.type === "video").length }}</span>
          <span>{{ t("queue.typeImage") }}: {{ batch.jobs.filter((j) => j.type === "image").length }}</span>
        </div>

        <!-- Job list -->
        <ScrollArea class="flex-1 max-h-[400px]">
          <div class="space-y-2">
            <QueueItem
              v-for="job in batch.jobs.filter((j) => j.status !== 'skipped')"
              :key="job.id"
              :job="job"
              :preset="getPresetForJob(job)"
              :can-cancel="['waiting', 'queued', 'processing', 'paused'].includes(job.status)"
              view-mode="compact"
              :progress-style="progressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              @cancel="emit('cancelJob', $event)"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
            />
          </div>
        </ScrollArea>

        <!-- Skipped items -->
        <div v-if="batch.skippedCount > 0" class="text-xs text-muted-foreground">
          {{ t("queue.status.skipped") }}: {{ batch.skippedCount }} {{ t("smartScan.subtitle") }}
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
