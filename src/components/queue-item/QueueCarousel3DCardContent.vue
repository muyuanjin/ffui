<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Folder } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import QueueJobWarnings from "@/components/queue-item/QueueJobWarnings.vue";
import type { CompositeBatchCompressTask, TranscodeJob } from "@/types";
import type { QueueListItem } from "@/composables";
import { getProgressVariant, getStatusClass, getTypeIcon } from "./queueCarousel3dView.helpers";

const props = defineProps<{
  item: QueueListItem;
  previewUrl: string | null;
  displayFilename: string;
  selected: boolean;
}>();

const emit = defineEmits<{
  inspectJob: [job: TranscodeJob];
  openBatchDetail: [batch: CompositeBatchCompressTask];
  compareJob: [job: TranscodeJob];
}>();

const { t } = useI18n();

const job = computed<TranscodeJob | null>(() => {
  if (props.item.kind === "job") return props.item.job;
  if (props.item.kind === "batch" && props.item.batch.currentJob) return props.item.batch.currentJob;
  if (props.item.kind === "batch" && props.item.batch.jobs.length > 0) return props.item.batch.jobs[0];
  return null;
});

const statusKey = computed(() => {
  if (props.item.kind !== "job") return null;
  const raw = props.item.job.status;
  return `queue.status.${raw === "queued" ? "waiting" : raw}`;
});
</script>

<template>
  <!-- 预览区：占据大部分卡片高度 -->
  <div class="relative flex-1 bg-muted/50 overflow-hidden">
    <img v-if="previewUrl" :src="previewUrl" alt="" class="w-full h-full object-cover" />
    <div v-else class="w-full h-full flex items-center justify-center">
      <component
        :is="item.kind === 'batch' ? Folder : getTypeIcon(item.kind === 'job' ? item.job.type : 'video')"
        class="h-16 w-16 text-muted-foreground/30"
      />
    </div>

    <div class="absolute top-2 left-2">
      <Badge
        v-if="item.kind === 'job'"
        variant="outline"
        class="px-1.5 py-0.5 text-[10px] font-medium"
        :class="getStatusClass(item.job.status)"
      >
        {{ statusKey ? t(statusKey) : "" }}
      </Badge>
      <Badge
        v-else
        variant="outline"
        class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300 bg-blue-500/20"
      >
        {{ t("queue.source.batchCompress") }}
      </Badge>
    </div>

    <div
      v-if="selected"
      class="absolute top-2 right-2 h-6 w-6 rounded-full bg-amber-500 border-2 border-amber-500 text-white flex items-center justify-center"
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  </div>

  <!-- 底部信息区：紧凑布局 -->
  <div class="px-2.5 py-1.5 space-y-1">
    <div class="flex items-center gap-2">
      <p class="flex-1 text-sm font-medium text-foreground truncate" :title="displayFilename">{{ displayFilename }}</p>
      <QueueJobWarnings v-if="item.kind === 'job'" :warnings="item.job.warnings" />
    </div>

    <!-- 进度条与百分比 -->
    <div v-if="item.kind === 'job'" class="flex items-center gap-2">
      <Progress
        v-if="item.job.status !== 'waiting' && item.job.status !== 'skipped'"
        :model-value="item.job.progress"
        :variant="getProgressVariant(item.job.status)"
        class="h-1 flex-1"
      />
      <span
        v-if="item.job.progress > 0 && item.job.progress < 100"
        class="text-[10px] text-muted-foreground font-mono shrink-0"
        >{{ Math.round(item.job.progress) }}%</span
      >
    </div>
    <div v-else class="flex items-center gap-2">
      <Progress :model-value="item.batch.overallProgress" class="h-1 flex-1" />
      <span class="text-[10px] text-muted-foreground font-mono shrink-0"
        >{{ item.batch.completedCount }}/{{ item.batch.totalCandidates }}</span
      >
    </div>

    <div class="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="link"
        size="sm"
        class="h-auto p-0 text-[10px]"
        @click.stop="item.kind === 'job' ? emit('inspectJob', item.job) : emit('openBatchDetail', item.batch)"
      >
        {{ t("jobDetail.title") }}
      </Button>
      <Button
        v-if="item.kind === 'job' && item.job.type === 'video' && job"
        type="button"
        variant="link"
        size="sm"
        class="h-auto p-0 text-[10px]"
        @click.stop="emit('compareJob', item.job)"
      >
        {{ t("jobCompare.open") }}
      </Button>
    </div>
  </div>
</template>
