<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "vue-i18n";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob, QueueProgressStyle } from "@/types";
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import { buildPreviewUrl } from "@/lib/backend";

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
  /** 排序比较函数，用于对子任务进行排序 */
  sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number;
}>();

/** 根据排序函数对子任务进行排序后的列表 */
const sortedJobs = computed<TranscodeJob[]>(() => {
  if (!props.batch) return [];
  const jobs = props.batch.jobs.filter((j) => j.status !== "skipped");
  if (!props.sortCompareFn) {
    return jobs;
  }
  return jobs.slice().sort(props.sortCompareFn);
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  compareJob: [job: TranscodeJob];
  cancelJob: [jobId: string];
  waitJob: [jobId: string];
  resumeJob: [jobId: string];
  restartJob: [jobId: string];
}>();

const { t } = useI18n();

// 右键菜单状态
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuJob = ref<TranscodeJob | null>(null);

const onJobContextMenu = (payload: { job: TranscodeJob; event: MouseEvent }) => {
  contextMenuJob.value = payload.job;
  contextMenuX.value = payload.event.clientX;
  contextMenuY.value = payload.event.clientY;
  contextMenuVisible.value = true;
};

const closeContextMenu = () => {
  contextMenuVisible.value = false;
  contextMenuJob.value = null;
};

// 右键菜单操作
const handleContextMenuWait = () => {
  if (contextMenuJob.value) {
    emit("waitJob", contextMenuJob.value.id);
  }
};

const handleContextMenuResume = () => {
  if (contextMenuJob.value) {
    emit("resumeJob", contextMenuJob.value.id);
  }
};

const handleContextMenuRestart = () => {
  if (contextMenuJob.value) {
    emit("restartJob", contextMenuJob.value.id);
  }
};

const handleContextMenuCancel = () => {
  if (contextMenuJob.value) {
    emit("cancelJob", contextMenuJob.value.id);
  }
};

const handleContextMenuInspect = () => {
  if (contextMenuJob.value) {
    emit("inspectJob", contextMenuJob.value);
  }
};

const handleContextMenuCompare = () => {
  if (contextMenuJob.value) {
    emit("compareJob", contextMenuJob.value);
  }
};

// 子任务操作按钮的可用性判断
const canWaitJob = (job: TranscodeJob) => job.status === "processing";
const canResumeJob = (job: TranscodeJob) => job.status === "paused";
const canRestartJob = (job: TranscodeJob) =>
  job.status !== "completed" && job.status !== "skipped";
const canCancelJob = (job: TranscodeJob) =>
  ["waiting", "queued", "processing", "paused"].includes(job.status);

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

// 9宫格预览图
type PreviewSlot = {
  key: string;
  previewPath: string | null;
  job: TranscodeJob | null;
};

const previewSlots = computed<PreviewSlot[]>(() => {
  if (!props.batch) return [];
  const jobs = props.batch.jobs ?? [];
  const slots: PreviewSlot[] = [];
  const usedJobIds = new Set<string>();

  // 统一计算有效预览路径：图片缺失 previewPath 时回退到 outputPath/inputPath。
  const getEffectivePreviewPath = (job: TranscodeJob): string | null => {
    if (job.previewPath) return job.previewPath;
    if (job.type === "image") {
      return job.outputPath || job.inputPath || null;
    }
    return job.previewPath ?? null;
  };

  type SlotSource = {
    job: TranscodeJob;
    previewPath: string | null;
  };

  const jobsWithPreview: SlotSource[] = [];
  const jobsWithoutPreview: SlotSource[] = [];

  for (const job of jobs) {
    const previewPath = getEffectivePreviewPath(job);
    if (previewPath) {
      jobsWithPreview.push({ job, previewPath });
    } else {
      jobsWithoutPreview.push({ job, previewPath: null });
    }
  }

  const pushJobSlot = (source: SlotSource) => {
    if (slots.length >= 9) return;
    const id = source.job.id;
    if (usedJobIds.has(id)) return;
    usedJobIds.add(id);

    slots.push({
      key: id,
      previewPath: source.previewPath,
      job: source.job,
    });
  };

  // 优先填充有预览的子任务，保证每个子任务最多出现一次，避免重复缩略图。
  for (const source of jobsWithPreview) {
    if (slots.length >= 9) break;
    pushJobSlot(source);
  }

  // 其余槽位用没有预览的子任务占位（可显示文件名），同样保证不重复。
  for (const source of jobsWithoutPreview) {
    if (slots.length >= 9) break;
    pushJobSlot(source);
  }

  // 不足 9 个时补齐占位槽，保持九宫格稳定布局。
  while (slots.length < 9) {
    const index = slots.length;
    slots.push({
      key: `placeholder-${index}`,
      previewPath: null,
      job: null,
    });
  }

  return slots;
});

const onPreviewClick = (job: TranscodeJob | null) => {
  if (job) {
    emit("previewJob", job);
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-4xl max-h-[90vh] flex flex-col overflow-y-auto">
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

      <div
        v-if="batch"
        class="flex flex-col gap-4 flex-1 min-h-0"
        data-testid="batch-detail-body"
      >
        <!-- 9宫格预览图 -->
        <div class="flex-shrink-0">
          <div class="grid grid-cols-3 gap-1 rounded-lg overflow-hidden bg-muted/40 max-h-36">
            <div
              v-for="slot in previewSlots"
              :key="slot.key"
              class="relative bg-background/40 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
              @click="onPreviewClick(slot.job)"
            >
              <img
                v-if="slot.previewPath"
                :src="buildPreviewUrl(slot.previewPath) ?? undefined"
                alt=""
                class="h-full w-full object-cover"
              />
              <div
                v-else
                class="h-full w-full bg-muted/60 flex items-center justify-center"
              >
                <span v-if="slot.job" class="text-[10px] text-muted-foreground truncate px-1">
                  {{ slot.job.filename?.split(/[/\\]/).pop() }}
                </span>
              </div>
              <!-- 状态指示器 -->
              <div
                v-if="slot.job"
                class="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full"
                :class="{
                  'bg-emerald-500': slot.job.status === 'completed',
                  'bg-blue-500 animate-pulse': slot.job.status === 'processing',
                  'bg-amber-500': slot.job.status === 'waiting' || slot.job.status === 'queued' || slot.job.status === 'paused',
                  'bg-red-500': slot.job.status === 'failed',
                  'bg-muted-foreground': slot.job.status === 'skipped' || slot.job.status === 'cancelled',
                }"
              />
            </div>
          </div>
        </div>

        <!-- Progress -->
        <div class="space-y-2 flex-shrink-0">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ t("jobDetail.progress") }}</span>
            <span class="font-mono">{{ Math.round(batch.overallProgress) }}%</span>
          </div>
          <Progress :model-value="batch.overallProgress" />
        </div>

        <!-- Statistics -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs flex-shrink-0">
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
        <div class="flex flex-wrap gap-4 text-xs text-muted-foreground flex-shrink-0">
          <span>{{ t("jobDetail.inputInfo") }}: {{ formatBytes(totalInputSize) }}</span>
          <span>{{ t("jobDetail.outputInfo") }}: {{ formatBytes(totalOutputSize) }}</span>
          <span v-if="compressionRatio">{{ t("jobDetail.ratio") }}: {{ compressionRatio }}%</span>
          <span>{{ t("queue.typeVideo") }}: {{ batch.jobs.filter((j) => j.type === "video").length }}</span>
          <span>{{ t("queue.typeImage") }}: {{ batch.jobs.filter((j) => j.type === "image").length }}</span>
          <span>{{ t("queue.typeAudio") }}: {{ batch.jobs.filter((j) => j.type === "audio").length }}</span>
        </div>

        <!-- Job list header -->
        <div class="flex items-center justify-between text-xs text-muted-foreground flex-shrink-0">
          <span class="font-medium">{{ t("app.tabs.queue") }}</span>
          <span>{{ batch.jobs.filter((j) => j.status !== 'skipped').length }} {{ t("smartScan.subtitle") }}</span>
        </div>

        <!-- Job list - 依赖整个对话框的垂直滚动，不再单独嵌套一层 ScrollArea，避免只有内层列表可以滚动的体验问题。 -->
        <div class="space-y-2 pr-3">
          <QueueItem
            v-for="job in sortedJobs"
            :key="job.id"
            :job="job"
            :preset="getPresetForJob(job)"
            :can-cancel="canCancelJob(job)"
            :can-wait="canWaitJob(job)"
            :can-resume="canResumeJob(job)"
            :can-restart="canRestartJob(job)"
            view-mode="compact"
            :progress-style="progressStyle"
            :progress-update-interval-ms="progressUpdateIntervalMs"
            @cancel="emit('cancelJob', $event)"
            @wait="emit('waitJob', $event)"
            @resume="emit('resumeJob', $event)"
            @restart="emit('restartJob', $event)"
            @inspect="emit('inspectJob', $event)"
            @preview="emit('previewJob', $event)"
            @compare="emit('compareJob', $event)"
            @contextmenu-job="onJobContextMenu"
          />
        </div>

        <!-- Skipped items -->
        <div v-if="batch.skippedCount > 0" class="text-xs text-muted-foreground flex-shrink-0">
          {{ t("queue.status.skipped") }}: {{ batch.skippedCount }} {{ t("smartScan.subtitle") }}
        </div>
      </div>

      <!-- 右键菜单 -->
      <QueueContextMenu
        :visible="contextMenuVisible"
        :x="contextMenuX"
        :y="contextMenuY"
        mode="single"
        :job-status="contextMenuJob?.status"
        queue-mode="queue"
        :has-selection="false"
        :can-reveal-input-path="!!contextMenuJob?.inputPath"
        :can-reveal-output-path="!!contextMenuJob?.outputPath"
	        @close="closeContextMenu"
	        @inspect="handleContextMenuInspect"
	        @compare="handleContextMenuCompare"
	        @wait="handleContextMenuWait"
	        @resume="handleContextMenuResume"
	        @restart="handleContextMenuRestart"
	        @cancel="handleContextMenuCancel"
      />
    </DialogContent>
  </Dialog>
</template>
