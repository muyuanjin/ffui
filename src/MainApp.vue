<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, FFmpegPreset, TranscodeJob } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";

import TitleBar from "@/components/TitleBar.vue";
import Sidebar from "@/components/Sidebar.vue";
import MonitorPanel from "@/components/panels/MonitorPanel.vue";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import MediaPanel from "@/components/panels/MediaPanel.vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";

import MainDragOverlay from "@/components/main/MainDragOverlay.vue";

import { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import { useMainAppSmartScan } from "@/composables/main-app/useMainAppSmartScan";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { useMainAppQueue } from "@/composables/main-app/useMainAppQueue";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { useJobLog } from "@/composables";
import { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import { copyToClipboard } from "@/lib/copyToClipboard";

const { t } = useI18n();

const jobs = ref<TranscodeJob[]>([]);
const queueError = ref<string | null>(null);
const lastQueueSnapshotAtMs = ref<number | null>(null);
const lastDroppedRoot = ref<string | null>(null);
const presets = ref<FFmpegPreset[]>([]);
const presetsLoadedFromBackend = ref(false);
const manualJobPresetId = ref<string | null>(null);
const completedCount = computed(() =>
  jobs.value.filter((job) => job.status === "completed").length,
);

const shell = useMainAppShell();
const dialogs = useMainAppDialogs();

const smartScan = useMainAppSmartScan({
  t,
  activeTab: shell.activeTab,
  jobs,
  presets,
  queueError,
  lastDroppedRoot,
  dialogManager: dialogs.dialogManager,
});

const presetsModule = useMainAppPresets({
  t,
  presets,
  presetsLoadedFromBackend,
  manualJobPresetId,
  dialogManager: dialogs.dialogManager,
  shell,
});

const queue = useMainAppQueue({
  t,
  jobs,
  queueError,
  lastQueueSnapshotAtMs,
  presets,
  manualJobPresetId,
  compositeSmartScanTasks: smartScan.compositeSmartScanTasks,
  compositeTasksById: smartScan.compositeTasksById,
});

const settings = useMainAppSettings({
  jobs,
  manualJobPresetId,
  smartConfig: smartScan.smartConfig,
});

const media = useMainAppMedia({
  t,
  activeTab: shell.activeTab,
});

const preview = useMainAppPreview({
  presets,
  dialogManager: dialogs.dialogManager,
});

const dnd = useMainAppDnDAndContextMenu({
  activeTab: shell.activeTab,
  inspectMediaForPath: media.inspectMediaForPath,
  enqueueManualJobFromPath: queue.enqueueManualJobFromPath,
  selectedJobIds: queue.selectedJobIds,
  bulkMoveSelectedJobsToTopInner: queue.bulkMoveSelectedJobsToTopInner,
});

const titleForTab = {
  queue: () => t("app.tabs.queue"),
  presets: () => t("app.tabs.presets"),
  media: () => t("app.tabs.media"),
  monitor: () => t("app.tabs.monitor"),
  settings: () => t("app.tabs.settings"),
};
const subtitleForTab = {
  queue: () => t("app.queueHint"),
  presets: () => t("app.presetsHint"),
  media: () => t("app.mediaHint"),
  monitor: () => t("app.monitorHint"),
  settings: () => t("app.settingsHint"),
};
const currentTitle = computed(() => titleForTab[shell.activeTab.value]?.() ?? titleForTab.queue());
const currentSubtitle = computed(() => subtitleForTab[shell.activeTab.value]?.() ?? "");

const { activeTab, minimizeWindow, toggleMaximizeWindow, closeWindow, cpuSnapshot, gpuSnapshot } =
  shell;
const { dialogManager, selectedJobForDetail } = dialogs;
const {
  presetPendingDelete,
  handleSavePreset,
  requestDeletePreset,
  confirmDeletePreset,
  cancelDeletePreset,
  openPresetEditor,
  addManualJob,
} = presetsModule;

const {
  queueViewMode,
  queueProgressStyle,
  queueMode,
  setQueueViewMode,
  setQueueProgressStyle,
  setQueueMode,
  queueViewModeModel,
  queueModeModel,
  queueProgressStyleModel,
  queueRowVariant,
  isIconViewMode,
  iconViewSize,
  iconGridClass,
  selectedJobIds,
  activeStatusFilters,
  activeTypeFilters,
  filterText,
  filterUseRegex,
  filterRegexError,
  sortPrimary,
  sortPrimaryDirection,
  hasActiveFilters,
  hasSelection,
  queueModeProcessingJobs,
  queueModeWaitingJobs,
  selectAllVisibleJobs,
  invertSelection,
  clearSelection,
  toggleStatusFilter,
  toggleTypeFilter,
  resetQueueFilters,
  toggleFilterRegexMode,
  toggleJobSelected,
  queueJobsForDisplay,
  visibleQueueItems,
  iconViewItems,
  handleWaitJob,
  handleResumeJob,
  handleRestartJob,
  handleCancelJob,
  bulkCancel,
  bulkWait,
  bulkResume,
  bulkRestart,
  bulkMoveToTop,
  bulkMoveToBottom,
  bulkMoveSelectedJobsToTopInner,
  bulkMoveSelectedJobsToBottomInner,
  moveJobToTop,
  bulkDelete,
} = queue;


const {
  appSettings,
  isSavingSettings,
  settingsSaveError,
  toolStatuses,
  progressUpdateIntervalMs,
  globalTaskbarProgressPercent,
  headerProgressPercent,
  headerProgressVisible,
  headerProgressFading,
} = settings;

const {
  inspectedMediaPath,
  inspectedPreviewUrl,
  inspectedIsImage,
  inspectedRawJson,
  inspectedAnalysis,
  isInspectingMedia,
  mediaInspectError,
  clearInspectedMedia,
  openMediaFileDialog,
} = media;

const {
  previewUrl,
  previewIsImage,
  previewError,
  openJobPreviewFromQueue,
  closeExpandedPreview,
  handleExpandedPreviewError,
  handleExpandedImagePreviewError,
  openPreviewInSystemPlayer,
  openBatchDetail,
  handleJobDetailExpandPreview,
  selectedJobPreset,
} = preview;

const {
  smartConfig,
  smartScanBatchMeta,
  expandedBatchIds,
  compositeSmartScanTasks,
  hasSmartScanBatches,
  startSmartScan,
  runSmartScan,
  closeSmartScanWizard,
  toggleBatchExpanded,
} = smartScan;

const queuePanelProps = createQueuePanelProps({
  queueJobsForDisplay,
  visibleQueueItems,
  iconViewItems,
  queueModeProcessingJobs,
  queueModeWaitingJobs,
  presets,
  queueViewMode,
  queueProgressStyleModel,
  queueMode,
  isIconViewMode,
  iconViewSize,
  iconGridClass,
  queueRowVariant,
  progressUpdateIntervalMs,
  hasSmartScanBatches,
  activeStatusFilters,
  activeTypeFilters,
  filterText,
  filterUseRegex,
  filterRegexError,
  sortPrimary,
  sortPrimaryDirection,
  hasSelection,
  hasActiveFilters,
  selectedJobIds,
  expandedBatchIds,
  queueError,
});

const {
  isDragging,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  waitingJobContextMenuVisible,
  closeWaitingJobContextMenu,
  handleWaitingJobContextMoveToTop,
} = dnd;

const { highlightedLogHtml } = useJobLog({ selectedJob: dialogManager.selectedJob });

const handleUpdateAppSettings = (next: AppSettings) => {
  appSettings.value = next;
};

const mainApp = {
  jobs,
  queueError,
  lastDroppedRoot,
  presets,
  presetsLoadedFromBackend,

  // Shell / dialogs / smart scan / settings / queue / media / preview / dnd
  ...shell,
  ...dialogs,
  ...smartScan,
  ...settings,
  ...presetsModule,
  ...queue,
  ...media,
  ...preview,
  ...dnd,

  currentTitle,
  currentSubtitle,

  selectedJobForDetail,
  globalTaskbarProgressPercent,
  compositeSmartScanTasks,
  smartScanBatchMeta,
  highlightedLogHtml,
  copyToClipboard,
};

// Keep manualJobPresetId behaving like a simple field for tests while still
// wiring it to the underlying ref used by composables.
Object.defineProperty(mainApp, "manualJobPresetId", {
  get() {
    return manualJobPresetId.value;
  },
  set(value: string | null) {
    manualJobPresetId.value = value;
  },
});

// Preserve the vm API used in existing tests (vm.jobs, vm.queueViewModeModel, vm.smartScanBatchMeta, etc.).
defineExpose(mainApp);
</script>

<template>
  <div
    class="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground m-0 p-0"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <MainDragOverlay :active-tab="activeTab" :is-dragging="isDragging" />

    <TitleBar
      :progress-percent="headerProgressPercent"
      :progress-visible="headerProgressVisible"
      :progress-fading="headerProgressFading"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximizeWindow"
      @close="closeWindow"
    />

    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">
      <Sidebar
        :active-tab="activeTab"
        :jobs="jobs"
        @update:active-tab="activeTab = $event"
        @add-job="addManualJob"
        @smart-scan="startSmartScan"
      />

      <main class="flex-1 flex min-h-0 flex-col bg-background">
        <MainContentHeader
          :active-tab="activeTab"
          :current-title="currentTitle"
          :current-subtitle="currentSubtitle"
          :jobs-length="jobs.length"
          :completed-count="completedCount"
          :manual-job-preset-id="manualJobPresetId"
          :presets="presets"
          :queue-mode-model="queueModeModel"
          :queue-view-mode-model="queueViewModeModel"
          @update:manualJobPresetId="(v) => (manualJobPresetId = v)"
          @update:queueModeModel="(v) => (queueModeModel = v as any)"
          @update:queueViewModeModel="(v) => (queueViewModeModel = v as any)"
          @openPresetWizard="dialogManager.openWizard()"
        />

        <ScrollArea class="flex-1">
          <div class="p-4">
            <QueuePanel
              v-if="activeTab === 'queue'"
              v-bind="queuePanelProps"
              @update:queue-view-mode="setQueueViewMode"
              @update:queue-mode="setQueueMode"
              @update:queue-progress-style="setQueueProgressStyle"
              @update:filter-text="(v) => (filterText = v)"
              @update:sort-primary="(v) => (sortPrimary = v)"
              @update:sort-primary-direction="(v) => (sortPrimaryDirection = v)"
              @add-job="addManualJob"
              @toggle-status-filter="toggleStatusFilter"
              @toggle-type-filter="toggleTypeFilter"
              @toggle-filter-regex-mode="toggleFilterRegexMode"
              @reset-queue-filters="resetQueueFilters"
              @select-all-visible-jobs="selectAllVisibleJobs"
              @invert-selection="invertSelection"
              @clear-selection="clearSelection"
              @bulk-cancel="bulkCancel"
              @bulk-wait="bulkWait"
              @bulk-resume="bulkResume"
              @bulk-restart="bulkRestart"
              @bulk-move-to-top="bulkMoveToTop"
              @bulk-move-to-bottom="bulkMoveToBottom"
              @bulk-delete="bulkDelete"
              @cancel-job="handleCancelJob"
              @wait-job="handleWaitJob"
              @resume-job="handleResumeJob"
              @restart-job="handleRestartJob"
              @toggle-job-selected="toggleJobSelected"
              @inspect-job="dialogManager.openJobDetail"
              @preview-job="openJobPreviewFromQueue"
              @toggle-batch-expanded="toggleBatchExpanded"
              @open-batch-detail="openBatchDetail"
            />

            <PresetPanel
              v-else-if="activeTab === 'presets'"
              :presets="presets"
              @edit="openPresetEditor"
              @delete="requestDeletePreset"
            />

            <MediaPanel
              v-else-if="activeTab === 'media'"
              :inspecting="isInspectingMedia"
              :error="mediaInspectError"
              :inspected-path="inspectedMediaPath"
              :preview-url="inspectedPreviewUrl"
              :is-image="inspectedIsImage"
              :analysis="inspectedAnalysis"
              :raw-json="inspectedRawJson"
              @inspect-requested="openMediaFileDialog"
              @clear="clearInspectedMedia"
            />

            <MonitorPanel
              v-else-if="activeTab === 'monitor'"
              :cpu-snapshot="cpuSnapshot ?? null"
              :gpu-snapshot="gpuSnapshot ?? null"
            />

            <SettingsPanel
              v-else-if="activeTab === 'settings'"
              :app-settings="appSettings"
              :tool-statuses="toolStatuses"
              :is-saving-settings="isSavingSettings"
              :settings-save-error="settingsSaveError"
              @refresh-tool-statuses="settings.refreshToolStatuses"
              @update:app-settings="handleUpdateAppSettings"
            />
          </div>
        </ScrollArea>
      </main>
    </div>

    <WaitingJobContextMenu
      :visible="waitingJobContextMenuVisible"
      @move-to-top="handleWaitingJobContextMoveToTop"
      @close="closeWaitingJobContextMenu"
    />

    <MainDialogsStack
      :dialog-manager="dialogManager"
      :presets="presets"
      :preset-pending-delete="presetPendingDelete"
      :smart-config="smartConfig"
      :queue-progress-style="queueProgressStyle"
      :progress-update-interval-ms="progressUpdateIntervalMs"
      :selected-job-preset="selectedJobPreset"
      :highlighted-log-html="highlightedLogHtml"
      :preview-url="previewUrl"
      :preview-is-image="previewIsImage"
      :preview-error="previewError"
      @savePreset="handleSavePreset"
      @closeWizard="dialogManager.closeWizard()"
      @closeParameterPanel="dialogManager.closeParameterPanel()"
      @runSmartScan="runSmartScan"
      @closeSmartScanWizard="closeSmartScanWizard"
      @confirmDeletePreset="confirmDeletePreset"
      @cancelDeletePreset="cancelDeletePreset"
      @closeJobDetail="dialogManager.closeJobDetail()"
      @handleJobDetailExpandPreview="handleJobDetailExpandPreview"
      @copyToClipboard="copyToClipboard($event)"
      @openJobPreviewFromQueue="openJobPreviewFromQueue"
      @handleCancelJob="handleCancelJob"
      @closeBatchDetail="dialogManager.closeBatchDetail()"
      @handleExpandedPreviewError="handleExpandedPreviewError"
      @handleExpandedImagePreviewError="handleExpandedImagePreviewError"
      @closeExpandedPreview="closeExpandedPreview"
      @openPreviewInSystemPlayer="openPreviewInSystemPlayer"
    />
  </div>
</template>
