<script setup lang="ts">
import { proxyRefs } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import TitleBar from "@/components/TitleBar.vue";
import { deriveProgressTransitionMs } from "@/lib/progressTransition";
import Sidebar from "@/components/Sidebar.vue";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import { MonitorPanelPro } from "@/components/main/lazyTabs";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import MainDialogsStackHost from "@/components/main/MainDialogsStackHost.vue";
import MainMediaTabHost from "@/components/main/MainMediaTabHost.vue";
import MainSettingsTabHost from "@/components/main/MainSettingsTabHost.vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import MainDragOverlay from "@/components/main/MainDragOverlay.vue";
import MainGlobalAlerts from "@/components/main/MainGlobalAlerts.vue";
import { createMainAppContext, provideMainAppContext } from "@/MainApp.setup";
import { useLocalePersistence } from "@/composables/main-app/useLocalePersistence";
import { useQueueBlankClickClearSelection } from "@/composables/main-app/useQueueBlankClickClearSelection";

const setup = createMainAppContext();
provideMainAppContext(setup);

const app = proxyRefs(setup);

const shell = proxyRefs(setup.shell);
const dialogs = setup.dialogs;
const queue = proxyRefs(setup.queue);
const batchCompress = setup.batchCompress;
const presetsModule = setup.presetsModule;
const media = setup.media;
const settings = setup.settings;
const settingsVm = proxyRefs(settings);
const updater = setup.updater;
const updaterVm = proxyRefs(updater);
const dnd = proxyRefs(setup.dnd);
const queueContextMenu = proxyRefs(setup.queueContextMenu);
const preview = setup.preview;

useQueueBlankClickClearSelection({
  activeTab: setup.shell.activeTab,
  hasSelection: setup.queue.hasSelection,
  clearSelection: setup.queue.clearSelection,
});

const { handleLocaleChange } = useLocalePersistence({
  appSettings: setup.settings.appSettings,
  handleUpdateAppSettings: setup.handleUpdateAppSettings,
});

const addManualJobsFromFiles = () => presetsModule.addManualJob("files");
const addManualJobsFromFolder = () => presetsModule.addManualJob("folder");

const clearMediaInspectError = () => {
  media.mediaInspectError.value = null;
};
</script>
<template>
  <div
    class="h-full w-full flex flex-col overflow-hidden bg-background text-foreground m-0 p-0"
    data-testid="ffui-app-root"
    @dragover="dnd.handleDragOver"
    @dragleave="dnd.handleDragLeave"
    @drop="dnd.handleDrop"
  >
    <MainDragOverlay :active-tab="shell.activeTab" :is-dragging="dnd.isDragging" />
    <TitleBar
      :current-title="app.currentTitle"
      :current-version="updaterVm.currentVersion"
      :progress-percent="settingsVm.headerProgressPercent"
      :progress-visible="settingsVm.headerProgressVisible"
      :progress-fading="settingsVm.headerProgressFading"
      :progress-transition-ms="deriveProgressTransitionMs(settingsVm.progressUpdateIntervalMs)"
      @minimize="shell.minimizeWindow"
      @toggle-maximize="shell.toggleMaximizeWindow"
      @close="shell.closeWindow"
      @locale-change="handleLocaleChange"
    />
    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">
      <Sidebar
        :active-tab="shell.activeTab"
        :jobs="app.jobs"
        :app-update-available="updaterVm.updateAvailable"
        @update:active-tab="shell.activeTab = $event"
        @add-job-files="addManualJobsFromFiles"
        @add-job-folder="addManualJobsFromFolder"
        @batch-compress="batchCompress.startBatchCompress"
      />
      <main class="flex-1 flex min-h-0 min-w-0 flex-col bg-background">
        <MainContentHeader
          :active-tab="shell.activeTab"
          :current-title="app.currentTitle"
          :current-subtitle="app.currentSubtitle"
          :jobs-length="app.jobs.length"
          :completed-count="app.completedCount"
          :manual-job-preset-id="app.manualJobPresetId"
          :presets="app.presets"
          :queue-view-mode-model="queue.queueViewModeModel"
          :preset-sort-mode="app.presetSortMode"
          :queue-output-policy="queue.queueOutputPolicy"
          :carousel-auto-rotation-speed="queue.carouselAutoRotationSpeed"
          @update:manualJobPresetId="(v) => (app.manualJobPresetId = v)"
          @update:queueViewModeModel="(v) => (queue.queueViewModeModel = v)"
          @update:queueOutputPolicy="(v) => queue.setQueueOutputPolicy(v)"
          @update:carouselAutoRotationSpeed="(v) => queue.setCarouselAutoRotationSpeed(v)"
          @openPresetWizard="dialogs.dialogManager.openWizard()"
        />
        <QueueFiltersBar
          v-if="shell.activeTab === 'queue'"
          :active-status-filters="queue.activeStatusFilters"
          :active-type-filters="queue.activeTypeFilters"
          :filter-text="queue.filterText"
          :filter-use-regex="queue.filterUseRegex"
          :filter-regex-error="queue.filterRegexError"
          :sort-primary="queue.sortPrimary"
          :sort-primary-direction="queue.sortPrimaryDirection"
          :sort-secondary="queue.sortSecondary"
          :sort-secondary-direction="queue.sortSecondaryDirection"
          :has-primary-sort-ties="queue.hasPrimarySortTies"
          :has-active-filters="queue.hasActiveFilters"
          :has-selection="queue.hasSelection"
          :selected-count="queue.selectedJobIds.size"
          :queue-mode="queue.queueMode"
          :visible-count="queue.queueJobsForDisplay.length"
          :total-count="queue.queueTotalCount"
          :selection-bar-pinned="queue.selectionBarPinned"
          :bulk-action-in-progress="queue.bulkActionInProgress"
          @update:queueMode="queue.setQueueMode"
          @toggle-status-filter="queue.toggleStatusFilter"
          @toggle-type-filter="queue.toggleTypeFilter"
          @update:filterText="(v) => (queue.filterText = v)"
          @toggle-filter-regex-mode="queue.toggleFilterRegexMode"
          @reset-queue-filters="queue.resetQueueFilters"
          @update:sortPrimary="(v) => (queue.sortPrimary = v)"
          @update:sortPrimaryDirection="(v) => (queue.sortPrimaryDirection = v)"
          @update:sortSecondary="(v) => (queue.sortSecondary = v)"
          @update:sortSecondaryDirection="(v) => (queue.sortSecondaryDirection = v)"
          @select-all-visible-jobs="queue.selectAllVisibleJobs"
          @invert-selection="queue.invertSelection"
          @clear-selection="queue.clearSelection"
          @bulk-cancel="queue.bulkCancel"
          @bulk-wait="queue.bulkWait"
          @bulk-resume="queue.bulkResume"
          @bulk-restart="queue.bulkRestart"
          @bulk-move-to-top="queue.bulkMoveToTop"
          @bulk-move-to-bottom="queue.bulkMoveToBottom"
          @bulk-delete="queue.bulkDelete"
          @update:selectionBarPinned="queue.setSelectionBarPinned"
        />
        <MainGlobalAlerts
          :queue-error="app.queueError"
          :media-inspect-error="media.mediaInspectError.value"
          :settings-save-error="settingsVm.settingsSaveError"
          @clearQueueError="app.queueError = null"
          @clearMediaInspectError="clearMediaInspectError"
          @clearSettingsSaveError="settingsVm.settingsSaveError = null"
        />
        <div v-if="shell.activeTab === 'queue'" class="flex-1 min-h-0 flex flex-col">
          <div class="p-4 flex-1 min-h-0 flex flex-col">
            <QueuePanel
              v-bind="queue.queuePanelProps"
              @update:queue-view-mode="queue.setQueueViewMode"
              @update:queue-mode="queue.setQueueMode"
              @update:queue-progress-style="queue.setQueueProgressStyle"
              @add-job-files="addManualJobsFromFiles"
              @add-job-folder="addManualJobsFromFolder"
              @cancel-job="queue.handleCancelJob"
              @wait-job="queue.handleWaitJob"
              @resume-job="queue.handleResumeJob"
              @restart-job="queue.handleRestartJob"
              @toggle-job-selected="queue.toggleJobSelected"
              @inspect-job="dialogs.dialogManager.openJobDetail"
              @preview-job="preview.openJobPreviewFromQueue"
              @compare-job="dialogs.dialogManager.openJobCompare"
              @toggle-batch-expanded="batchCompress.toggleBatchExpanded"
              @open-batch-detail="preview.openBatchDetail"
              @open-job-context-menu="queueContextMenu.openQueueContextMenuForJob"
              @open-bulk-context-menu="queueContextMenu.openQueueContextMenuForBulk"
            />
          </div>
        </div>
        <ScrollArea v-else class="flex-1 min-h-0">
          <div class="min-h-full flex flex-col" :class="shell.activeTab === 'presets' ? undefined : 'p-4'">
            <PresetTabPanel
              v-if="shell.activeTab === 'presets'"
              :presets="app.presets"
              :preset-sort-mode="app.presetSortMode"
              :preset-view-mode="app.presetViewMode"
              :preset-selection-bar-pinned="app.presetSelectionBarPinned"
              :set-preset-selection-bar-pinned="app.setPresetSelectionBarPinned"
              :set-preset-sort-mode="(v) => (app.presetSortMode = v)"
              :set-preset-view-mode="(v) => (app.presetViewMode = v)"
              :dialog-manager="dialogs.dialogManager"
              :presets-module="presetsModule"
            />
            <MainMediaTabHost v-else-if="shell.activeTab === 'media'" :media="media" />
            <MonitorPanelPro v-else-if="shell.activeTab === 'monitor'" />
            <MainSettingsTabHost
              v-else-if="shell.activeTab === 'settings'"
              :settings="settings"
              :updater="updater"
              :reload-presets="presetsModule.reloadPresets"
              :update-app-settings="app.handleUpdateAppSettings"
            />
          </div>
        </ScrollArea>
      </main>
    </div>
    <WaitingJobContextMenu
      :visible="dnd.waitingJobContextMenuVisible"
      @move-to-top="dnd.handleWaitingJobContextMoveToTop"
      @close="dnd.closeWaitingJobContextMenu"
    />
    <QueueContextMenu
      :visible="queueContextMenu.queueContextMenuVisible"
      :x="queueContextMenu.queueContextMenuX"
      :y="queueContextMenu.queueContextMenuY"
      :mode="queueContextMenu.queueContextMenuMode"
      :job-status="queueContextMenu.queueContextMenuJobStatus"
      :job-type="queueContextMenu.queueContextMenuJob?.type"
      :queue-mode="queue.queueMode"
      :has-selection="queue.hasSelection"
      :bulk-action-in-progress="queue.bulkActionInProgress"
      :can-reveal-input-path="queueContextMenu.queueContextMenuCanRevealInputPath"
      :can-reveal-output-path="queueContextMenu.queueContextMenuCanRevealOutputPath"
      @inspect="queueContextMenu.handleQueueContextInspect"
      @compare="queueContextMenu.handleQueueContextCompare"
      @wait="queueContextMenu.handleQueueContextWait"
      @resume="queueContextMenu.handleQueueContextResume"
      @restart="queueContextMenu.handleQueueContextRestart"
      @cancel="queueContextMenu.handleQueueContextCancel"
      @move-to-top="queueContextMenu.handleQueueContextMoveToTop"
      @move-to-bottom="queueContextMenu.handleQueueContextMoveToBottom"
      @remove="queueContextMenu.handleQueueContextDelete"
      @open-input-folder="queueContextMenu.handleQueueContextOpenInputFolder"
      @open-output-folder="queueContextMenu.handleQueueContextOpenOutputFolder"
      @copy-input-path="queueContextMenu.handleQueueContextCopyInputPath"
      @copy-output-path="queueContextMenu.handleQueueContextCopyOutputPath"
      @close="queueContextMenu.closeQueueContextMenu"
    />
    <MainDialogsStackHost :setup="setup" @openToolsSettings="shell.activeTab = 'settings'" />
  </div>
</template>
