<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import QueueBatchCompressBatchCard from "./QueueBatchCompressBatchCard.vue";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import type { TranscodeJob, CompositeBatchCompressTask } from "@/types";
import type { QueuePanelEmits, QueuePanelProps } from "./QueuePanel.types";

// Lazy load queue item components
const QueueItem = defineAsyncComponent(() => import("@/components/QueueItem.vue"));
const QueueIconItem = defineAsyncComponent(() => import("@/components/QueueIconItem.vue"));
const QueueBatchCompressIconBatchItem = defineAsyncComponent(
  () => import("@/components/QueueBatchCompressIconBatchItem.vue"),
);
const QueueCarousel3DView = defineAsyncComponent(() => import("@/components/queue-item/QueueCarousel3DView.vue"));

const props = defineProps<QueuePanelProps>();
const emit = defineEmits<QueuePanelEmits>();

const { t, locale } = useI18n();

const emptyQueueBadgeLines = computed(() => {
  const label = t("app.tabs.queue");
  const currentLocale = String(locale.value ?? "");

  if (currentLocale.startsWith("zh")) {
    // Chinese: prefer a balanced 2+2 split for "任务队列" instead of breaking characters arbitrarily.
    return label.length === 4 ? [label.slice(0, 2), label.slice(2)] : [label];
  }

  // Non-Chinese: prefer word boundaries (e.g. "Transcode" + "Queue").
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 2) return parts;
  if (parts.length > 2) return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
  return [label];
});

const isBatchExpanded = (batchId: string) => props.expandedBatchIds.has(batchId);

const canCancelJob = (job: TranscodeJob): boolean => {
  return hasTauri() && ["waiting", "queued", "processing", "paused"].includes(job.status);
};

/**
 * 判断一个 Batch Compress 批次是否“完全选中”（所有子任务都在 selectedJobIds 中）。
 * 用于图标视图下的复合卡片选中状态和批量点击行为。
 */
const isBatchFullySelected = (batch: CompositeBatchCompressTask): boolean => {
  const jobs = batch.jobs ?? [];
  if (jobs.length === 0) return false;
  for (const job of jobs) {
    if (!props.selectedJobIds.has(job.id)) {
      return false;
    }
  }
  return true;
};

/**
 * 在图标视图中点击复合任务卡片时的批量选中逻辑：
 * - 如果当前批次所有子任务都已选中，则取消该批次所有子任务的选中；
 * - 否则，仅为该批次中未被选中的子任务补齐选中状态，不影响其它任务的选中。
 */
const handleToggleBatchSelection = (batch: CompositeBatchCompressTask) => {
  const jobs = batch.jobs ?? [];
  if (jobs.length === 0) return;

  const fullySelected = isBatchFullySelected(batch);

  if (fullySelected) {
    // 批次已经处于“全选”状态时，点击视为“取消选中该批次所有子任务”
    for (const job of jobs) {
      if (props.selectedJobIds.has(job.id)) {
        emit("toggleJobSelected", job.id);
      }
    }
  } else {
    // 批次尚未全选时，仅为未选中的子任务补齐选中，避免“逐个取反”导致的半选中困惑
    for (const job of jobs) {
      if (!props.selectedJobIds.has(job.id)) {
        emit("toggleJobSelected", job.id);
      }
    }
  }
};

/**
 * 在图标视图中右键复合任务卡片时的批量操作入口：
 * - 先清空现有选中，再选中该批次所有子任务；
 * - 随后以 bulk 模式打开队列右键菜单，使“删除/暂停/继续/移动”等操作明确作用于该批次。
 */
const handleBatchContextMenu = (batch: CompositeBatchCompressTask, event: MouseEvent) => {
  const jobs = batch.jobs ?? [];

  // 重置选中集为该批次的子任务集合，保持与右键单个任务时的心智一致
  emit("clearSelection");
  for (const job of jobs) {
    emit("toggleJobSelected", job.id);
  }

  emit("openBulkContextMenu", event);
};
</script>

<template>
  <section
    class="flex flex-1 min-h-0 flex-col gap-4 w-full min-w-0"
    data-testid="queue-panel"
    @contextmenu.prevent="(event) => emit('openBulkContextMenu', event)"
  >
    <!-- Empty state
         Only show when the queue is truly empty (no jobs and no batches) and
         no filters are active. When filters hide all jobs, keep the secondary
         header visible so users can adjust filters instead of seeing an
         "empty queue" screen. -->
    <div
      v-if="queueJobsForDisplay.length === 0 && !hasBatchCompressBatches && !hasActiveFilters"
      class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl hover:border-sidebar-ring/70 hover:text-foreground transition-all"
    >
      <div
        class="mx-auto mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-card/70"
        data-testid="ffui-empty-queue-badge"
      >
        <div
          :class="[
            'flex w-full max-w-full flex-col items-center justify-center px-1 text-center font-semibold text-muted-foreground',
            locale.startsWith('zh') ? 'text-[10px] leading-3' : 'text-[8px] leading-3 tracking-normal',
          ]"
          data-testid="ffui-empty-queue-badge-label"
        >
          <span
            v-for="(line, idx) in emptyQueueBadgeLines"
            :key="idx"
            :data-testid="`ffui-empty-queue-badge-line-${idx}`"
          >
            {{ line }}
          </span>
        </div>
      </div>
      <p class="text-lg font-medium">
        {{ t("app.emptyQueue.title") }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{ t("app.emptyQueue.subtitle") }}
      </p>
      <div class="mt-6 flex items-center justify-center">
        <div
          class="relative grid w-full max-w-xs grid-cols-2 overflow-hidden rounded-md after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-white/35"
        >
          <Button size="lg" class="rounded-none font-semibold text-white" @click="emit('addJobFiles')">
            {{ t("app.actions.addJobFiles") }}
          </Button>
          <Button
            size="lg"
            variant="manualFolder"
            class="rounded-none font-semibold text-white"
            @click="emit('addJobFolder')"
          >
            {{ t("app.actions.addJobFolder") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Queue content -->
    <div v-else class="flex flex-1 min-h-0 flex-col">
      <!-- 3D Carousel view mode -->
      <div v-if="isCarousel3dViewMode" class="flex-1 min-h-0">
        <QueueCarousel3DView
          class="h-full"
          :items="visibleQueueItems"
          :selected-job-ids="selectedJobIds"
          :progress-style="queueProgressStyle"
          :auto-rotation-speed="carouselAutoRotationSpeed"
          @toggle-job-selected="emit('toggleJobSelected', $event)"
          @inspect-job="emit('inspectJob', $event)"
          @preview-job="emit('previewJob', $event)"
          @compare-job="emit('compareJob', $event)"
          @open-job-context-menu="emit('openJobContextMenu', $event)"
          @open-batch-detail="emit('openBatchDetail', $event)"
          @toggle-batch-selection="handleToggleBatchSelection($event)"
          @contextmenu-batch="(payload) => handleBatchContextMenu(payload.batch, payload.event)"
        />
      </div>

      <!-- Icon view mode -->
      <div v-else-if="isIconViewMode" class="flex-1 min-h-0">
        <div data-testid="queue-icon-grid" :class="iconGridClass">
          <template v-for="item in iconViewItems" :key="item.kind === 'batch' ? item.batch.batchId : item.job.id">
            <QueueIconItem
              v-if="item.kind === 'job'"
              :job="item.job"
              :is-pausing="pausingJobIds.has(item.job.id)"
              :size="iconViewSize"
              :progress-style="queueProgressStyle"
              :can-select="true"
              :selected="selectedJobIds.has(item.job.id)"
              @toggle-select="emit('toggleJobSelected', $event)"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
              @compare="emit('compareJob', $event)"
              @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
            />
            <QueueBatchCompressIconBatchItem
              v-else
              :batch="item.batch"
              :size="iconViewSize"
              :progress-style="queueProgressStyle"
              :can-select="true"
              :selected="isBatchFullySelected(item.batch)"
              @open-detail="emit('openBatchDetail', $event)"
              @toggle-select="handleToggleBatchSelection(item.batch)"
              @contextmenu-batch="(payload) => handleBatchContextMenu(item.batch, payload.event)"
            />
          </template>
        </div>
      </div>

      <!-- List view mode -->
      <div v-else class="flex-1 min-h-0">
        <!-- Queue mode: Processing / Waiting groups -->
        <div v-if="queueMode === 'queue'" class="space-y-4">
          <div v-if="queueModeProcessingJobs.length > 0" class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-semibold text-muted-foreground uppercase">
                {{ t("queue.groups.processing") }}
              </span>
              <span class="text-[11px] text-muted-foreground">
                {{ queueModeProcessingJobs.length }}
              </span>
            </div>
            <div>
              <QueueItem
                v-for="job in queueModeProcessingJobs"
                :key="job.id"
                :job="job"
                :is-pausing="pausingJobIds.has(job.id)"
                :preset="presets.find((p) => p.id === job.presetId) ?? presets[0]"
                :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                :can-cancel="canCancelJob(job)"
                :can-wait="hasTauri()"
                :can-resume="hasTauri()"
                :can-restart="hasTauri()"
                :can-select="true"
                :selected="selectedJobIds.has(job.id)"
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
                @compare="emit('compareJob', $event)"
                @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
              />
            </div>
          </div>

          <div v-if="queueModeWaitingItems.length > 0" class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-semibold text-muted-foreground uppercase">
                {{ t("queue.groups.waiting") }}
              </span>
              <span class="text-[11px] text-muted-foreground">
                {{ queueModeWaitingItems.length }}
              </span>
            </div>
            <div>
              <template
                v-for="item in queueModeWaitingItems"
                :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
              >
                <QueueBatchCompressBatchCard
                  v-if="item.kind === 'batch'"
                  :batch="item.batch"
                  :presets="presets"
                  :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                  :queue-row-variant="queueRowVariant"
                  :queue-progress-style="queueProgressStyle"
                  :progress-update-interval-ms="progressUpdateIntervalMs"
                  :selected-job-ids="selectedJobIds"
                  :is-expanded="isBatchExpanded(item.batch.batchId)"
                  :can-cancel-job="canCancelJob"
                  :sort-compare-fn="sortCompareFn"
                  @toggle-batch-expanded="emit('toggleBatchExpanded', $event)"
                  @cancel-job="emit('cancelJob', $event)"
                  @wait-job="emit('waitJob', $event)"
                  @resume-job="emit('resumeJob', $event)"
                  @restart-job="emit('restartJob', $event)"
                  @toggle-job-selected="emit('toggleJobSelected', $event)"
                  @inspect-job="emit('inspectJob', $event)"
                  @preview-job="emit('previewJob', $event)"
                  @compare-job="emit('compareJob', $event)"
                  @open-job-context-menu="emit('openJobContextMenu', $event)"
                  @contextmenu-batch="(payload) => handleBatchContextMenu(item.batch, payload.event)"
                />
                <QueueItem
                  v-else
                  :job="item.job"
                  :is-pausing="pausingJobIds.has(item.job.id)"
                  :preset="presets.find((p) => p.id === item.job.presetId) ?? presets[0]"
                  :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                  :can-cancel="canCancelJob(item.job)"
                  :can-wait="hasTauri()"
                  :can-resume="hasTauri()"
                  :can-restart="hasTauri()"
                  :can-select="true"
                  :selected="selectedJobIds.has(item.job.id)"
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
                  @compare="emit('compareJob', $event)"
                  @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
                />
              </template>
            </div>
          </div>

          <!-- Batch Compress batches in queue mode -->
          <div
            v-for="item in visibleQueueItems"
            :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
            class="mb-3"
          >
            <QueueBatchCompressBatchCard
              v-if="item.kind === 'batch' && !queueModeWaitingBatchIds.has(item.batch.batchId)"
              :batch="item.batch"
              :presets="presets"
              :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
              :queue-row-variant="queueRowVariant"
              :queue-progress-style="queueProgressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              :selected-job-ids="selectedJobIds"
              :is-expanded="isBatchExpanded(item.batch.batchId)"
              :can-cancel-job="canCancelJob"
              :sort-compare-fn="sortCompareFn"
              @toggle-batch-expanded="emit('toggleBatchExpanded', $event)"
              @cancel-job="emit('cancelJob', $event)"
              @wait-job="emit('waitJob', $event)"
              @resume-job="emit('resumeJob', $event)"
              @restart-job="emit('restartJob', $event)"
              @toggle-job-selected="emit('toggleJobSelected', $event)"
              @inspect-job="emit('inspectJob', $event)"
              @preview-job="emit('previewJob', $event)"
              @compare-job="emit('compareJob', $event)"
              @open-job-context-menu="emit('openJobContextMenu', $event)"
              @contextmenu-batch="(payload) => handleBatchContextMenu(item.batch, payload.event)"
            />
            <QueueItem
              v-else-if="
                item.kind === 'job' && ['completed', 'failed', 'cancelled', 'skipped'].includes(item.job.status)
              "
              :job="item.job"
              :is-pausing="pausingJobIds.has(item.job.id)"
              :preset="presets.find((p) => p.id === item.job.presetId) ?? presets[0]"
              :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
              :can-cancel="false"
              :can-restart="hasTauri() && queueMode === 'queue'"
              :can-select="true"
              :selected="selectedJobIds.has(item.job.id)"
              :view-mode="queueRowVariant"
              :progress-style="queueProgressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              @cancel="emit('cancelJob', $event)"
              @restart="emit('restartJob', $event)"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
              @compare="emit('compareJob', $event)"
            />
          </div>
        </div>

        <!-- Display mode: flat list -->
        <div v-else>
          <div
            v-for="item in visibleQueueItems"
            :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
            class="mb-3"
          >
            <QueueBatchCompressBatchCard
              v-if="item.kind === 'batch'"
              :batch="item.batch"
              :presets="presets"
              :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
              :queue-row-variant="queueRowVariant"
              :queue-progress-style="queueProgressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              :selected-job-ids="selectedJobIds"
              :is-expanded="isBatchExpanded(item.batch.batchId)"
              :can-cancel-job="canCancelJob"
              :sort-compare-fn="sortCompareFn"
              @toggle-batch-expanded="emit('toggleBatchExpanded', $event)"
              @cancel-job="emit('cancelJob', $event)"
              @wait-job="emit('waitJob', $event)"
              @resume-job="emit('resumeJob', $event)"
              @restart-job="emit('restartJob', $event)"
              @toggle-job-selected="emit('toggleJobSelected', $event)"
              @inspect-job="emit('inspectJob', $event)"
              @preview-job="emit('previewJob', $event)"
              @compare-job="emit('compareJob', $event)"
              @open-job-context-menu="emit('openJobContextMenu', $event)"
              @contextmenu-batch="(payload) => handleBatchContextMenu(item.batch, payload.event)"
            />
            <QueueItem
              v-else
              :job="item.job"
              :is-pausing="pausingJobIds.has(item.job.id)"
              :preset="presets.find((p) => p.id === item.job.presetId) ?? presets[0]"
              :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
              :can-cancel="canCancelJob(item.job)"
              :can-wait="hasTauri()"
              :can-resume="hasTauri()"
              :can-restart="hasTauri()"
              :can-select="true"
              :selected="selectedJobIds.has(item.job.id)"
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
              @compare="emit('compareJob', $event)"
              @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
