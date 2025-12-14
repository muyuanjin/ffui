<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import QueueSmartScanBatchCard from "./QueueSmartScanBatchCard.vue";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import type {
  TranscodeJob,
  FFmpegPreset,
  CompositeSmartScanTask,
  QueueViewMode,
  QueueProgressStyle,
  QueueMode,
} from "@/types";
import type { QueueFilterStatus, QueueFilterKind, QueueSortField, QueueSortDirection, QueueListItem } from "@/composables";

// Lazy load queue item components
const QueueItem = defineAsyncComponent(() => import("@/components/QueueItem.vue"));
const QueueIconItem = defineAsyncComponent(() => import("@/components/QueueIconItem.vue"));
const QueueSmartScanIconBatchItem = defineAsyncComponent(
  () => import("@/components/QueueSmartScanIconBatchItem.vue"),
);

const props = defineProps<{
  // Queue items
  queueJobsForDisplay: TranscodeJob[];
  visibleQueueItems: QueueListItem[];
  iconViewItems: QueueListItem[];
  queueModeProcessingJobs: TranscodeJob[];
  queueModeWaitingItems: QueueListItem[];
  queueModeWaitingBatchIds: Set<string>;
  /** UI-only: jobs that have requested pause but are still processing. */
  pausingJobIds: Set<string>;
  presets: FFmpegPreset[];

  // View settings
  queueViewMode: QueueViewMode;
  /** Resolved ffmpeg executable path from backend/tool status (if known). */
  ffmpegResolvedPath?: string | null;
  queueProgressStyle: QueueProgressStyle;
  queueMode: QueueMode;
  isIconViewMode: boolean;
  iconViewSize: "small" | "medium" | "large";
  iconGridClass: string;
  queueRowVariant: "detail" | "compact";
  progressUpdateIntervalMs: number;
  hasSmartScanBatches: boolean;

  // Filter/sort state
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
  sortPrimary: QueueSortField;
  sortPrimaryDirection: QueueSortDirection;
  hasSelection: boolean;
  hasActiveFilters: boolean;
   /** IDs of currently selected jobs for visual checkboxes. */
  selectedJobIds: Set<string>;
  selectedCount: number;

  // Batch expansion
  expandedBatchIds: Set<string>;

  /** 排序比较函数，用于对批次子任务进行排序 */
  sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number;
}>();

const emit = defineEmits<{
  "update:queueViewMode": [value: QueueViewMode];
  "update:queueProgressStyle": [value: QueueProgressStyle];
  "update:queueMode": [value: QueueMode];
  "update:filterText": [value: string];
  "update:sortPrimary": [value: QueueSortField];
  "update:sortPrimaryDirection": [value: QueueSortDirection];
  addJobFiles: [];
  addJobFolder: [];
  toggleStatusFilter: [status: QueueFilterStatus];
  toggleTypeFilter: [kind: QueueFilterKind];
  toggleFilterRegexMode: [];
  resetQueueFilters: [];
  selectAllVisibleJobs: [];
  invertSelection: [];
  clearSelection: [];
  bulkCancel: [];
  bulkWait: [];
  bulkResume: [];
  bulkRestart: [];
  bulkMoveToTop: [];
  bulkMoveToBottom: [];
  bulkDelete: [];
  cancelJob: [jobId: string];
  waitJob: [jobId: string];
  resumeJob: [jobId: string];
  restartJob: [jobId: string];
  toggleJobSelected: [jobId: string];
  inspectJob: [job: TranscodeJob];
  previewJob: [job: TranscodeJob];
  toggleBatchExpanded: [batchId: string];
  openBatchDetail: [batch: CompositeSmartScanTask];
  isJobSelected: [jobId: string];
  openJobContextMenu: [payload: { job: TranscodeJob; event: MouseEvent }];
  openBulkContextMenu: [event: MouseEvent];
}>();

const { t } = useI18n();

const isBatchExpanded = (batchId: string) => props.expandedBatchIds.has(batchId);

const canCancelJob = (job: TranscodeJob): boolean => {
  return hasTauri() && ["waiting", "queued", "processing", "paused"].includes(job.status);
};

/**
 * 判断一个 Smart Scan 批次是否“完全选中”（所有子任务都在 selectedJobIds 中）。
 * 用于图标视图下的复合卡片选中状态和批量点击行为。
 */
const isBatchFullySelected = (batch: CompositeSmartScanTask): boolean => {
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
const handleToggleBatchSelection = (batch: CompositeSmartScanTask) => {
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
const handleBatchContextMenu = (batch: CompositeSmartScanTask, event: MouseEvent) => {
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
    class="space-y-4 w-full min-w-0"
    data-testid="queue-panel"
    @contextmenu.prevent="(event) => emit('openBulkContextMenu', event)"
  >
    <!-- Empty state
         Only show when the queue is truly empty (no jobs and no batches) and
         no filters are active. When filters hide all jobs, keep the secondary
         header visible so users can adjust filters instead of seeing an
         "empty queue" screen. -->
    <div
      v-if="queueJobsForDisplay.length === 0 && !hasSmartScanBatches && !hasActiveFilters"
      class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl hover:border-sidebar-ring/70 hover:text-foreground transition-all"
    >
      <div
        class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card/70"
      >
        <span class="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground whitespace-nowrap">
          {{ t("app.tabs.queue") }}
        </span>
      </div>
      <p class="text-lg font-medium">
        {{ t("app.emptyQueue.title") }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{ t("app.emptyQueue.subtitle") }}
      </p>
      <div class="mt-6 flex items-center justify-center">
        <div class="flex overflow-hidden rounded-md">
          <Button size="lg" class="rounded-r-none" @click="emit('addJobFiles')">
            {{ t("app.actions.addJobFiles") }}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            class="rounded-l-none border-l border-border/60"
            @click="emit('addJobFolder')"
          >
            {{ t("app.actions.addJobFolder") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Queue content -->
    <div v-else>
      <!-- Icon view mode -->
      <div v-if="isIconViewMode">
        <div data-testid="queue-icon-grid" :class="iconGridClass">
          <template
            v-for="item in iconViewItems"
            :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
          >
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
              @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
            />
            <QueueSmartScanIconBatchItem
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
      <div v-else>
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
                <QueueSmartScanBatchCard
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
                  @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
                />
              </template>
            </div>
          </div>

          <!-- Smart Scan batches in queue mode -->
          <div
            v-for="item in visibleQueueItems"
            :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
            class="mb-3"
          >
            <QueueSmartScanBatchCard
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
              @open-job-context-menu="emit('openJobContextMenu', $event)"
              @contextmenu-batch="(payload) => handleBatchContextMenu(item.batch, payload.event)"
            />
            <QueueItem
              v-else-if="item.kind === 'job' && ['completed', 'failed', 'cancelled', 'skipped'].includes(item.job.status)"
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
            <QueueSmartScanBatchCard
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
              @contextmenu-job="(payload) => emit('openJobContextMenu', payload)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
