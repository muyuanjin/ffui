<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
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
  queueModeWaitingJobs: TranscodeJob[];
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

  // Error state
  queueError: string | null;
}>();

const emit = defineEmits<{
  "update:queueViewMode": [value: QueueViewMode];
  "update:queueProgressStyle": [value: QueueProgressStyle];
  "update:queueMode": [value: QueueMode];
  "update:filterText": [value: string];
  "update:sortPrimary": [value: QueueSortField];
  "update:sortPrimaryDirection": [value: QueueSortDirection];
  addJob: [];
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
</script>

<template>
  <section
    class="space-y-4 max-w-4xl mx-auto"
    data-testid="queue-panel"
    @contextmenu.prevent="(event) => emit('openBulkContextMenu', event)"
  >
    <!-- Error banner -->
    <div
      v-if="queueError"
      class="mb-4 border border-destructive/60 bg-destructive/10 text-destructive text-xs rounded-md px-3 py-2 flex items-start gap-2"
    >
      <span class="mt-0.5">!</span>
      <span>{{ queueError }}</span>
    </div>

    <!-- Empty state
         Only show when the queue is truly empty (no jobs and no batches) and
         no filters are active. When filters hide all jobs, keep the secondary
         header visible so users can adjust filters instead of seeing an
         "empty queue" screen. -->
    <div
      v-if="queueJobsForDisplay.length === 0 && !hasSmartScanBatches && !hasActiveFilters"
      class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-sidebar-ring/70 hover:text-foreground transition-all"
      @click="emit('addJob')"
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
    </div>

    <!-- Queue content -->
    <div v-else>
      <!-- Icon view mode -->
          <div v-if="isIconViewMode">
            <div data-testid="queue-icon-grid" :class="iconGridClass">
              <template v-for="item in iconViewItems" :key="item.kind === 'batch' ? item.batch.batchId : item.job.id">
                <QueueIconItem
                  v-if="item.kind === 'job'"
                  :job="item.job"
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
              @open-detail="emit('openBatchDetail', $event)"
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

          <div v-if="queueModeWaitingJobs.length > 0" class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-semibold text-muted-foreground uppercase">
                {{ t("queue.groups.waiting") }}
              </span>
              <span class="text-[11px] text-muted-foreground">
                {{ queueModeWaitingJobs.length }}
              </span>
            </div>
            <div>
              <QueueItem
                v-for="job in queueModeWaitingJobs"
                :key="job.id"
                :job="job"
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

          <!-- Smart Scan batches in queue mode -->
          <div
            v-for="item in visibleQueueItems"
            :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
            class="mb-3"
          >
            <Card
              v-if="item.kind === 'batch'"
              data-testid="smart-scan-batch-card"
              class="border-border/70 bg-card/90 shadow-sm hover:border-primary/40 transition-colors"
            >
              <CardHeader
                class="pb-2 flex flex-row items-start justify-between gap-3 cursor-pointer"
                @click="emit('toggleBatchExpanded', item.batch.batchId)"
              >
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <Badge variant="outline" class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300">
                      {{ t("queue.source.smartScan") }}
                    </Badge>
                    <span class="text-xs text-muted-foreground">
                      {{ item.batch.totalProcessed }} / {{ item.batch.totalCandidates }}
                    </span>
                  </div>
                  <CardTitle class="text-sm font-semibold truncate max-w-lg">
                    {{ item.batch.rootPath || t("smartScan.title") }}
                  </CardTitle>
                  <CardDescription class="text-xs text-muted-foreground">
                    <span v-if="item.batch.currentJob">{{ item.batch.currentJob.filename }}</span>
                    <span v-else>{{ t("smartScan.subtitle") }}</span>
                  </CardDescription>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <span class="text-xs font-mono text-muted-foreground">{{ Math.round(item.batch.overallProgress) }}%</span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    class="h-6 w-6 rounded-full border-border/60 bg-muted/40 text-xs"
                    @click.stop="emit('toggleBatchExpanded', item.batch.batchId)"
                  >
                    <span v-if="isBatchExpanded(item.batch.batchId)">−</span>
                    <span v-else>＋</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent class="pt-0 pb-3 space-y-2">
                <Progress :model-value="item.batch.overallProgress" />
                <div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>{{ t("queue.typeVideo") }} / {{ t("queue.typeImage") }}: {{ item.batch.jobs.filter((j) => j.type === "video").length }} / {{ item.batch.jobs.filter((j) => j.type === "image").length }}</span>
                  <span>{{ t("queue.status.completed") }}: {{ item.batch.completedCount }}</span>
                  <span v-if="item.batch.skippedCount > 0">{{ t("queue.status.skipped") }}: {{ item.batch.skippedCount }}</span>
                  <span v-if="item.batch.failedCount > 0">{{ t("queue.status.failed") }}: {{ item.batch.failedCount }}</span>
                </div>
                <div v-if="isBatchExpanded(item.batch.batchId)" data-testid="smart-scan-batch-children" class="mt-2 space-y-2">
                  <QueueItem
                    v-for="child in item.batch.jobs.filter((j) => j.status !== 'skipped')"
                    :key="child.id"
                    :job="child"
                    :preset="presets.find((p) => p.id === child.presetId) ?? presets[0]"
                    :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                    :can-cancel="canCancelJob(child)"
                    :view-mode="queueRowVariant"
                    :progress-style="queueProgressStyle"
                    :progress-update-interval-ms="progressUpdateIntervalMs"
                    @cancel="emit('cancelJob', $event)"
                    @inspect="emit('inspectJob', $event)"
                    @preview="emit('previewJob', $event)"
                  />
                </div>
              </CardContent>
            </Card>
            <QueueItem
              v-else-if="item.kind === 'job' && ['completed', 'failed', 'cancelled', 'skipped'].includes(item.job.status)"
              :job="item.job"
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
            <Card
              v-if="item.kind === 'batch'"
              data-testid="smart-scan-batch-card"
              class="border-border/70 bg-card/90 shadow-sm hover:border-primary/40 transition-colors"
            >
              <CardHeader
                class="pb-2 flex flex-row items-start justify-between gap-3 cursor-pointer"
                @click="emit('toggleBatchExpanded', item.batch.batchId)"
              >
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <Badge variant="outline" class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300">
                      {{ t("queue.source.smartScan") }}
                    </Badge>
                    <span class="text-xs text-muted-foreground">
                      {{ item.batch.totalProcessed }} / {{ item.batch.totalCandidates }}
                    </span>
                  </div>
                  <CardTitle class="text-sm font-semibold truncate max-w-lg">
                    {{ item.batch.rootPath || t("smartScan.title") }}
                  </CardTitle>
                  <CardDescription class="text-xs text-muted-foreground">
                    <span v-if="item.batch.currentJob">{{ item.batch.currentJob.filename }}</span>
                    <span v-else>{{ t("smartScan.subtitle") }}</span>
                  </CardDescription>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <span class="text-xs font-mono text-muted-foreground">{{ Math.round(item.batch.overallProgress) }}%</span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    class="h-6 w-6 rounded-full border-border/60 bg-muted/40 text-xs"
                    @click.stop="emit('toggleBatchExpanded', item.batch.batchId)"
                  >
                    <span v-if="isBatchExpanded(item.batch.batchId)">−</span>
                    <span v-else>＋</span>
                  </Button>
                </div>
              </CardHeader>
            <CardContent class="pt-0 pb-3 space-y-2">
              <Progress :model-value="item.batch.overallProgress" />
              <div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>{{ t("queue.typeVideo") }} / {{ t("queue.typeImage") }}: {{ item.batch.jobs.filter((j) => j.type === "video").length }} / {{ item.batch.jobs.filter((j) => j.type === "image").length }}</span>
                  <span>{{ t("queue.status.completed") }}: {{ item.batch.completedCount }}</span>
                  <span v-if="item.batch.skippedCount > 0">{{ t("queue.status.skipped") }}: {{ item.batch.skippedCount }}</span>
                  <span v-if="item.batch.failedCount > 0">{{ t("queue.status.failed") }}: {{ item.batch.failedCount }}</span>
                </div>
                <div v-if="isBatchExpanded(item.batch.batchId)" data-testid="smart-scan-batch-children" class="mt-2 space-y-2">
                  <QueueItem
                    v-for="child in item.batch.jobs.filter((j) => j.status !== 'skipped')"
                    :key="child.id"
                    :job="child"
                    :preset="presets.find((p) => p.id === child.presetId) ?? presets[0]"
                    :ffmpeg-resolved-path="ffmpegResolvedPath ?? null"
                    :can-cancel="canCancelJob(child)"
                    :view-mode="queueRowVariant"
                    :progress-style="queueProgressStyle"
                    :progress-update-interval-ms="progressUpdateIntervalMs"
                    @cancel="emit('cancelJob', $event)"
                    @inspect="emit('inspectJob', $event)"
                    @preview="emit('previewJob', $event)"
                  />
                </div>
              </CardContent>
            </Card>
            <QueueItem
              v-else
              :job="item.job"
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
