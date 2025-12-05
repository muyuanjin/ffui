<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
const QueueSmartScanIconBatchItem = defineAsyncComponent(() => import("@/components/QueueSmartScanIconBatchItem.vue"));

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
}>();

const { t } = useI18n();

const isBatchExpanded = (batchId: string) => props.expandedBatchIds.has(batchId);

const canCancelJob = (job: TranscodeJob): boolean => {
  return hasTauri() && ["waiting", "queued", "processing", "paused"].includes(job.status);
};
</script>

<template>
  <section class="space-y-4 max-w-4xl mx-auto">
    <!-- Error banner -->
    <div
      v-if="queueError"
      class="mb-4 border border-destructive/60 bg-destructive/10 text-destructive text-xs rounded-md px-3 py-2 flex items-start gap-2"
    >
      <span class="mt-0.5">!</span>
      <span>{{ queueError }}</span>
    </div>

    <!-- Empty state -->
    <div
      v-if="queueJobsForDisplay.length === 0 && !hasSmartScanBatches"
      class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-sidebar-ring/70 hover:text-foreground transition-all"
      @click="emit('addJob')"
    >
      <div
        class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card/70"
      >
        <span class="text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
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
      <!-- Filters and controls -->
      <div class="mb-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span class="font-semibold">{{ t("queue.filters.label") }}</span>
            <div class="flex flex-wrap items-center gap-1">
              <Button
                v-for="statusKey in ['processing','waiting','queued','paused','completed','failed','cancelled','skipped']"
                :key="statusKey"
                variant="outline"
                size="xs"
                class="h-6 px-2 text-[10px]"
                :class="activeStatusFilters.has(statusKey as any) ? 'bg-primary text-primary-foreground border-primary/60' : ''"
                @click="emit('toggleStatusFilter', statusKey as any)"
              >
                {{ t(`queue.status.${statusKey}`) }}
              </Button>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('selectAllVisibleJobs')">
              {{ t("queue.selection.selectAll") }}
            </Button>
            <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('invertSelection')">
              {{ t("queue.selection.invert") }}
            </Button>
            <Button variant="ghost" size="xs" class="h-6 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('clearSelection')">
              {{ t("queue.selection.clear") }}
            </Button>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] text-muted-foreground">{{ t("queue.filters.typeLabel") }}</span>
            <Button
              variant="outline"
              size="xs"
              class="h-6 px-2 text-[10px]"
              :class="activeTypeFilters.has('manual') ? 'bg-primary text-primary-foreground border-primary/60' : ''"
              @click="emit('toggleTypeFilter', 'manual')"
            >
              {{ t("queue.filters.typeManual") }}
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="h-6 px-2 text-[10px]"
              :class="activeTypeFilters.has('smartScan') ? 'bg-primary text-primary-foreground border-primary/60' : ''"
              @click="emit('toggleTypeFilter', 'smartScan')"
            >
              {{ t("queue.filters.typeSmartScan") }}
            </Button>

            <Input
              :model-value="filterText"
              class="h-7 w-48 text-xs"
              :placeholder="t('queue.filters.textPlaceholder')"
              @update:model-value="(v) => emit('update:filterText', String(v))"
            />
            <Button
              variant="outline"
              size="xs"
              class="h-7 px-2 text-[10px]"
              :class="filterUseRegex ? 'bg-primary text-primary-foreground border-primary/60' : ''"
              @click="emit('toggleFilterRegexMode')"
            >
              /regex/
            </Button>
            <Button variant="ghost" size="xs" class="h-7 px-2 text-[10px]" @click="emit('resetQueueFilters')">
              {{ t("queue.filters.reset") }}
            </Button>
            <p v-if="filterRegexError" class="text-[11px] text-destructive">{{ filterRegexError }}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{{ t("queue.sort.label") }}</span>
              <Select :model-value="sortPrimary" @update:model-value="(v) => emit('update:sortPrimary', v as QueueSortField)">
                <SelectTrigger class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="addedTime">{{ t("queue.sort.fields.addedTime") }}</SelectItem>
                  <SelectItem value="finishedTime">{{ t("queue.sort.fields.finishedTime") }}</SelectItem>
                  <SelectItem value="filename">{{ t("queue.sort.fields.filename") }}</SelectItem>
                  <SelectItem value="status">{{ t("queue.sort.fields.status") }}</SelectItem>
                  <SelectItem value="progress">{{ t("queue.sort.fields.progress") }}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="xs"
                class="h-7 px-2 text-[10px]"
                :class="sortPrimaryDirection === 'asc' ? 'bg-primary text-primary-foreground border-primary/60' : ''"
                @click="emit('update:sortPrimaryDirection', 'asc')"
              >
                {{ t("queue.sort.asc") }}
              </Button>
              <Button
                variant="outline"
                size="xs"
                class="h-7 px-2 text-[10px]"
                :class="sortPrimaryDirection === 'desc' ? 'bg-primary text-primary-foreground border-primary/60' : ''"
                @click="emit('update:sortPrimaryDirection', 'desc')"
              >
                {{ t("queue.sort.desc") }}
              </Button>
            </div>

            <div class="flex flex-wrap items-center gap-1">
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('bulkCancel')">
                {{ t("queue.actions.bulkCancel") }}
              </Button>
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulkWait')">
                {{ t("queue.actions.bulkWait") }}
              </Button>
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulkResume')">
                {{ t("queue.actions.bulkResume") }}
              </Button>
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulkRestart')">
                {{ t("queue.actions.bulkRestart") }}
              </Button>
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulkMoveToTop')">
                {{ t("queue.actions.bulkMoveToTop") }}
              </Button>
              <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulkMoveToBottom')">
                {{ t("queue.actions.bulkMoveToBottom") }}
              </Button>
              <Button variant="ghost" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('bulkDelete')">
                {{ t("queue.actions.bulkDelete") }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Icon view mode -->
      <div v-if="isIconViewMode">
        <div data-testid="queue-icon-grid" :class="iconGridClass">
          <template v-for="item in iconViewItems" :key="item.kind === 'batch' ? item.batch.batchId : item.job.id">
            <QueueIconItem
              v-if="item.kind === 'job'"
              :job="item.job"
              :size="iconViewSize"
              :progress-style="queueProgressStyle"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
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
              <span class="text-xs font-semibold text-muted-foreground uppercase">Processing</span>
              <span class="text-[11px] text-muted-foreground">{{ queueModeProcessingJobs.length }}</span>
            </div>
            <div>
              <QueueItem
                v-for="job in queueModeProcessingJobs"
                :key="job.id"
                :job="job"
                :preset="presets.find((p) => p.id === job.presetId) ?? presets[0]"
                :can-cancel="canCancelJob(job)"
                :can-wait="hasTauri() && queueMode === 'queue'"
                :can-resume="hasTauri() && queueMode === 'queue'"
                :can-restart="hasTauri() && queueMode === 'queue'"
                :can-select="queueMode === 'queue'"
                :selected="false"
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
              />
            </div>
          </div>

          <div v-if="queueModeWaitingJobs.length > 0" class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-semibold text-muted-foreground uppercase">Waiting</span>
              <span class="text-[11px] text-muted-foreground">{{ queueModeWaitingJobs.length }}</span>
            </div>
            <div>
              <QueueItem
                v-for="job in queueModeWaitingJobs"
                :key="job.id"
                :job="job"
                :preset="presets.find((p) => p.id === job.presetId) ?? presets[0]"
                :can-cancel="canCancelJob(job)"
                :can-wait="hasTauri() && queueMode === 'queue'"
                :can-resume="hasTauri() && queueMode === 'queue'"
                :can-restart="hasTauri() && queueMode === 'queue'"
                :can-select="queueMode === 'queue'"
                :selected="false"
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
              :can-cancel="false"
              :view-mode="queueRowVariant"
              :progress-style="queueProgressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              @cancel="emit('cancelJob', $event)"
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
              :can-cancel="canCancelJob(item.job)"
              :view-mode="queueRowVariant"
              :progress-style="queueProgressStyle"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              @cancel="emit('cancelJob', $event)"
              @inspect="emit('inspectJob', $event)"
              @preview="emit('previewJob', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
