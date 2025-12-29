<script setup lang="ts">
import { computed } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import TitleBar from "@/components/TitleBar.vue";
import { deriveProgressTransitionMs } from "@/lib/progressTransition";
import Sidebar from "@/components/Sidebar.vue";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import { MonitorPanelPro, SettingsPanel } from "@/components/main/lazyTabs";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import MainDialogsStackHost from "@/components/main/MainDialogsStackHost.vue";
import MainMediaTabHost from "@/components/main/MainMediaTabHost.vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import MainDragOverlay from "@/components/main/MainDragOverlay.vue";
import MainGlobalAlerts from "@/components/main/MainGlobalAlerts.vue";
import { useMainAppSetup } from "@/composables/main-app/useMainAppSetup";
import { useLocalePersistence } from "@/composables/main-app/useLocalePersistence";
import { useQueueBlankClickClearSelection } from "@/composables/main-app/useQueueBlankClickClearSelection";

const setup = useMainAppSetup();

const {
  jobs,
  completedCount,
  presets,
  currentTitle,
  currentSubtitle,
  queueError,
  presetSortMode,
  presetViewMode,
  presetSelectionBarPinned,
  setPresetSelectionBarPinned,
  handleUpdateAppSettings,
  manualJobPresetId: manualJobPresetIdRef,
} = setup;

const { activeTab, minimizeWindow, toggleMaximizeWindow, closeWindow } = setup.shell;
const { dialogManager } = setup.dialogs;

const {
  activeStatusFilters,
  activeTypeFilters,
  filterText,
  filterUseRegex,
  filterRegexError,
  sortPrimary,
  sortPrimaryDirection,
  sortSecondary,
  sortSecondaryDirection,
  hasPrimarySortTies,
  hasActiveFilters,
  hasSelection,
  selectedJobIds,
  selectionBarPinned,
  setSelectionBarPinned,
  queueMode,
  queueTotalCount,
  queueJobsForDisplay,
  queueOutputPolicy,
  setQueueOutputPolicy,
  queuePanelProps,
  setQueueMode,
  toggleStatusFilter,
  toggleTypeFilter,
  toggleFilterRegexMode,
  resetQueueFilters,
  selectAllVisibleJobs,
  invertSelection,
  clearSelection,
  queueViewModeModel,
  setQueueViewMode,
  setQueueProgressStyle,
  carouselAutoRotationSpeed,
  setCarouselAutoRotationSpeed,
  handleCancelJob,
  handleWaitJob,
  handleResumeJob,
  handleRestartJob,
  toggleJobSelected,
  bulkCancel,
  bulkWait,
  bulkResume,
  bulkRestart,
  bulkMoveToTop,
  bulkMoveToBottom,
  bulkDelete,
  bulkActionInProgress,
} = setup.queue;

const { startBatchCompress, toggleBatchExpanded } = setup.batchCompress;

const { addManualJob, reloadPresets } = setup.presetsModule;

const media = setup.media;

const {
  appSettings,
  toolStatuses,
  toolStatusesFresh,
  isSavingSettings,
  settingsSaveError,
  progressUpdateIntervalMs,
  headerProgressPercent,
  headerProgressVisible,
  headerProgressFading,
} = setup.settings;

const settings = setup.settings;

const {
  updaterConfigured,
  updateAvailable,
  availableVersion,
  availableBody,
  currentVersion,
  lastCheckedAtMs,
  downloadedBytes,
  totalBytes,
  isCheckingForUpdate,
  isInstallingUpdate,
  updateCheckError,
  autoCheckDefault,
  checkForAppUpdate,
  downloadAndInstallUpdate,
} = setup.updater;

const {
  isDragging,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  waitingJobContextMenuVisible,
  handleWaitingJobContextMoveToTop,
  closeWaitingJobContextMenu,
} = setup.dnd;

const {
  queueContextMenuVisible,
  queueContextMenuX,
  queueContextMenuY,
  queueContextMenuMode,
  queueContextMenuJob,
  queueContextMenuJobStatus,
  queueContextMenuCanRevealInputPath,
  queueContextMenuCanRevealOutputPath,
  openQueueContextMenuForJob,
  openQueueContextMenuForBulk,
  closeQueueContextMenu,
  handleQueueContextInspect,
  handleQueueContextCompare,
  handleQueueContextWait,
  handleQueueContextResume,
  handleQueueContextRestart,
  handleQueueContextCancel,
  handleQueueContextMoveToTop,
  handleQueueContextMoveToBottom,
  handleQueueContextDelete,
  handleQueueContextOpenInputFolder,
  handleQueueContextOpenOutputFolder,
  handleQueueContextCopyInputPath,
  handleQueueContextCopyOutputPath,
} = setup.queueContextMenu;

const { openJobPreviewFromQueue, openBatchDetail } = setup.preview;

useQueueBlankClickClearSelection({ activeTab, hasSelection, clearSelection });
const { handleLocaleChange } = useLocalePersistence({ appSettings, handleUpdateAppSettings });
const addManualJobsFromFiles = () => addManualJob("files");
const addManualJobsFromFolder = () => addManualJob("folder");
const manualJobPresetId = computed<string | null>({
  get() {
    return manualJobPresetIdRef.value;
  },
  set(value) {
    manualJobPresetIdRef.value = value;
  },
});

const clearMediaInspectError = () => {
  media.mediaInspectError.value = null;
};
</script>
<template>
  <div
    class="h-full w-full flex flex-col overflow-hidden bg-background text-foreground m-0 p-0"
    data-testid="ffui-app-root"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <MainDragOverlay :active-tab="activeTab" :is-dragging="isDragging" />
    <TitleBar
      :current-title="currentTitle"
      :current-version="currentVersion"
      :progress-percent="headerProgressPercent"
      :progress-visible="headerProgressVisible"
      :progress-fading="headerProgressFading"
      :progress-transition-ms="deriveProgressTransitionMs(progressUpdateIntervalMs)"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximizeWindow"
      @close="closeWindow"
      @locale-change="handleLocaleChange"
    />
    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">
      <Sidebar
        :active-tab="activeTab"
        :jobs="jobs"
        :app-update-available="updateAvailable"
        @update:active-tab="activeTab = $event"
        @add-job-files="addManualJobsFromFiles"
        @add-job-folder="addManualJobsFromFolder"
        @batch-compress="startBatchCompress"
      />
      <main class="flex-1 flex min-h-0 min-w-0 flex-col bg-background">
        <MainContentHeader
          :active-tab="activeTab"
          :current-title="currentTitle"
          :current-subtitle="currentSubtitle"
          :jobs-length="jobs.length"
          :completed-count="completedCount"
          :manual-job-preset-id="manualJobPresetId"
          :presets="presets"
          :queue-view-mode-model="queueViewModeModel"
          :preset-sort-mode="presetSortMode"
          :queue-output-policy="queueOutputPolicy"
          :carousel-auto-rotation-speed="carouselAutoRotationSpeed"
          @update:manualJobPresetId="(v) => (manualJobPresetId = v)"
          @update:queueViewModeModel="(v) => (queueViewModeModel = v)"
          @update:queueOutputPolicy="(v) => setQueueOutputPolicy(v)"
          @update:carouselAutoRotationSpeed="(v) => setCarouselAutoRotationSpeed(v)"
          @openPresetWizard="dialogManager.openWizard()"
        />
        <QueueFiltersBar
          v-if="activeTab === 'queue'"
          :active-status-filters="activeStatusFilters"
          :active-type-filters="activeTypeFilters"
          :filter-text="filterText"
          :filter-use-regex="filterUseRegex"
          :filter-regex-error="filterRegexError"
          :sort-primary="sortPrimary"
          :sort-primary-direction="sortPrimaryDirection"
          :sort-secondary="sortSecondary"
          :sort-secondary-direction="sortSecondaryDirection"
          :has-primary-sort-ties="hasPrimarySortTies"
          :has-active-filters="hasActiveFilters"
          :has-selection="hasSelection"
          :selected-count="selectedJobIds.size"
          :queue-mode="queueMode"
          :visible-count="queueJobsForDisplay.length"
          :total-count="queueTotalCount"
          :selection-bar-pinned="selectionBarPinned"
          :bulk-action-in-progress="bulkActionInProgress"
          @update:queueMode="setQueueMode"
          @toggle-status-filter="toggleStatusFilter"
          @toggle-type-filter="toggleTypeFilter"
          @update:filterText="(v) => (filterText = v)"
          @toggle-filter-regex-mode="toggleFilterRegexMode"
          @reset-queue-filters="resetQueueFilters"
          @update:sortPrimary="(v) => (sortPrimary = v)"
          @update:sortPrimaryDirection="(v) => (sortPrimaryDirection = v)"
          @update:sortSecondary="(v) => (sortSecondary = v)"
          @update:sortSecondaryDirection="(v) => (sortSecondaryDirection = v)"
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
          @update:selectionBarPinned="setSelectionBarPinned"
        />
        <MainGlobalAlerts
          :queue-error="queueError"
          :media-inspect-error="media.mediaInspectError.value"
          :settings-save-error="settingsSaveError"
          @clearQueueError="queueError = null"
          @clearMediaInspectError="clearMediaInspectError"
          @clearSettingsSaveError="settingsSaveError = null"
        />
        <div v-if="activeTab === 'queue'" class="flex-1 min-h-0 flex flex-col">
          <div class="p-4 flex-1 min-h-0 flex flex-col">
            <QueuePanel
              v-bind="queuePanelProps"
              @update:queue-view-mode="setQueueViewMode"
              @update:queue-mode="setQueueMode"
              @update:queue-progress-style="setQueueProgressStyle"
              @add-job-files="addManualJobsFromFiles"
              @add-job-folder="addManualJobsFromFolder"
              @cancel-job="handleCancelJob"
              @wait-job="handleWaitJob"
              @resume-job="handleResumeJob"
              @restart-job="handleRestartJob"
              @toggle-job-selected="toggleJobSelected"
              @inspect-job="dialogManager.openJobDetail"
              @preview-job="openJobPreviewFromQueue"
              @compare-job="dialogManager.openJobCompare"
              @toggle-batch-expanded="toggleBatchExpanded"
              @open-batch-detail="openBatchDetail"
              @open-job-context-menu="openQueueContextMenuForJob"
              @open-bulk-context-menu="openQueueContextMenuForBulk"
            />
          </div>
        </div>
        <ScrollArea v-else class="flex-1 min-h-0">
          <div class="min-h-full flex flex-col" :class="activeTab === 'presets' ? undefined : 'p-4'">
            <PresetTabPanel
              v-if="activeTab === 'presets'"
              :presets="presets"
              :preset-sort-mode="presetSortMode"
              :preset-view-mode="presetViewMode"
              :preset-selection-bar-pinned="presetSelectionBarPinned"
              :set-preset-selection-bar-pinned="setPresetSelectionBarPinned"
              :set-preset-sort-mode="(v) => (presetSortMode = v)"
              :set-preset-view-mode="(v) => (presetViewMode = v)"
              :dialog-manager="dialogManager"
              :presets-module="setup.presetsModule"
            />
            <MainMediaTabHost v-else-if="activeTab === 'media'" :media="media" />
            <MonitorPanelPro v-else-if="activeTab === 'monitor'" />
            <SettingsPanel
              v-else-if="activeTab === 'settings'"
              :app-settings="appSettings"
              :tool-statuses="toolStatuses"
              :tool-statuses-fresh="toolStatusesFresh"
              :refresh-tool-statuses="settings.refreshToolStatuses"
              :is-saving-settings="isSavingSettings"
              :settings-save-error="settingsSaveError"
              :reload-presets="reloadPresets"
              :app-update="{
                configured: updaterConfigured,
                autoCheckDefault,
                available: updateAvailable,
                checking: isCheckingForUpdate,
                installing: isInstallingUpdate,
                availableVersion,
                availableBody,
                currentVersion,
                lastCheckedAtMs,
                downloadedBytes,
                totalBytes,
                error: updateCheckError,
              }"
              :check-for-app-update="checkForAppUpdate"
              :install-app-update="downloadAndInstallUpdate"
              :fetch-tool-candidates="settings.fetchToolCandidates"
              @update:app-settings="handleUpdateAppSettings"
              @download-tool="settings.downloadToolNow"
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
    <QueueContextMenu
      :visible="queueContextMenuVisible"
      :x="queueContextMenuX"
      :y="queueContextMenuY"
      :mode="queueContextMenuMode"
      :job-status="queueContextMenuJobStatus"
      :job-type="queueContextMenuJob?.type"
      :queue-mode="queueMode"
      :has-selection="hasSelection"
      :bulk-action-in-progress="bulkActionInProgress"
      :can-reveal-input-path="queueContextMenuCanRevealInputPath"
      :can-reveal-output-path="queueContextMenuCanRevealOutputPath"
      @inspect="handleQueueContextInspect"
      @compare="handleQueueContextCompare"
      @wait="handleQueueContextWait"
      @resume="handleQueueContextResume"
      @restart="handleQueueContextRestart"
      @cancel="handleQueueContextCancel"
      @move-to-top="handleQueueContextMoveToTop"
      @move-to-bottom="handleQueueContextMoveToBottom"
      @remove="handleQueueContextDelete"
      @open-input-folder="handleQueueContextOpenInputFolder"
      @open-output-folder="handleQueueContextOpenOutputFolder"
      @copy-input-path="handleQueueContextCopyInputPath"
      @copy-output-path="handleQueueContextCopyOutputPath"
      @close="closeQueueContextMenu"
    />
    <MainDialogsStackHost :setup="setup" @openToolsSettings="activeTab = 'settings'" />
  </div>
</template>
