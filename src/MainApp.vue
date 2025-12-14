<script setup lang="ts">
import { computed } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";

import TitleBar from "@/components/TitleBar.vue";
import Sidebar from "@/components/Sidebar.vue";
import MonitorPanelPro from "@/components/panels/MonitorPanelPro.vue";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import MediaPanel from "@/components/panels/MediaPanel.vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import MainDialogsStack from "@/components/main/MainDialogsStack.vue";
import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";
import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
import MainDragOverlay from "@/components/main/MainDragOverlay.vue";
import MainGlobalAlerts from "@/components/main/MainGlobalAlerts.vue";

import { useMainAppSetup } from "@/composables/main-app/useMainAppSetup";

const { mainApp, manualJobPresetId: manualJobPresetIdRef } = useMainAppSetup();

// 仅解构模板中直接使用到的绑定，其余字段通过 defineExpose 暴露给测试。
const {
  // Shell / 标题栏与侧边栏
  activeTab,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  jobs,
  completedCount,
  presets,
  currentTitle,
  currentSubtitle,

  // 队列过滤与排序
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
  queueMode,
  queueJobsForDisplay,
  setQueueMode,
  toggleStatusFilter,
  toggleTypeFilter,
  toggleFilterRegexMode,
  resetQueueFilters,
  selectAllVisibleJobs,
  invertSelection,
  clearSelection,

  // 队列视图与操作
  queueViewModeModel,
  queuePanelProps,
  queueError,
  addManualJob,
  startSmartScan,
  setQueueViewMode,
  setQueueProgressStyle,
  handleCancelJob,
  handleWaitJob,
  handleResumeJob,
  handleRestartJob,
  toggleJobSelected,
  toggleBatchExpanded,
  openBatchDetail,

  // 队列批量操作
  bulkCancel,
  bulkWait,
  bulkResume,
  bulkRestart,
  bulkMoveToTop,
  bulkMoveToBottom,
  bulkDelete,

  // 媒体检查
  isInspectingMedia,
  mediaInspectError,
  inspectedMediaPath,
  inspectedPreviewUrl,
  inspectedIsImage,
  inspectedAnalysis,
  inspectedRawJson,
  openMediaFileDialog,
  clearInspectedMedia,

  // 设置与外部工具
  appSettings,
  toolStatuses,
  toolStatusesFresh,
  isSavingSettings,
  settingsSaveError,
  handleUpdateAppSettings,
  settings,

  // 应用更新
  updaterConfigured,
  updateAvailable,
  availableVersion,
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

  // 拖拽与等待任务右键菜单
  isDragging,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  waitingJobContextMenuVisible,
  handleWaitingJobContextMoveToTop,
  closeWaitingJobContextMenu,

  // 队列上下文菜单
  queueContextMenuVisible,
  queueContextMenuX,
  queueContextMenuY,
  queueContextMenuMode,
  queueContextMenuJobStatus,
  queueContextMenuCanRevealInputPath,
  queueContextMenuCanRevealOutputPath,
  openQueueContextMenuForJob,
  openQueueContextMenuForBulk,
  closeQueueContextMenu,
  handleQueueContextInspect,
  handleQueueContextWait,
  handleQueueContextResume,
  handleQueueContextRestart,
  handleQueueContextCancel,
  handleQueueContextMoveToTop,
  handleQueueContextMoveToBottom,
  handleQueueContextDelete,
  handleQueueContextOpenInputFolder,
  handleQueueContextOpenOutputFolder,

  // 对话框栈 / 智能扫描 / 预览
  dialogManager,
  presetPendingDelete,
  openPresetEditor,
  requestDeletePreset,
  handleReorderPresets,
  smartConfig,
  queueProgressStyle,
  progressUpdateIntervalMs,
  selectedJobPreset,
  jobDetailLogText,
  highlightedLogHtml,
  previewUrl,
  previewIsImage,
  previewError,
  ffmpegResolvedPath,
  handleImportSmartPackConfirmed,
  handleSavePreset,
  runSmartScan,
  closeSmartScanWizard,
  confirmDeletePreset,
  cancelDeletePreset,
  handleJobDetailExpandPreview,
  copyToClipboard,
  handleExpandedPreviewError,
  handleExpandedImagePreviewError,
  closeExpandedPreview,
  openPreviewInSystemPlayer,
  openJobPreviewFromQueue,

  // 标题栏进度
  headerProgressPercent,
  headerProgressVisible,
  headerProgressFading,

  // 预设排序模式和视图模式
  presetSortMode,
  presetViewMode,

  // 选择操作栏固定状态
  selectionBarPinned,
  setSelectionBarPinned,

  // 排序比较函数（用于批次子任务排序）
  compareJobsForDisplay,
} = mainApp as any;

const manualJobPresetId = computed<string | null>({
  get() {
    return manualJobPresetIdRef.value;
  },
  set(value) {
    manualJobPresetIdRef.value = value;
  },
});

defineExpose({
  ...mainApp,
  get manualJobPresetId() {
    return manualJobPresetIdRef.value;
  },
  set manualJobPresetId(value: string | null) {
    manualJobPresetIdRef.value = value;
  },
});
</script>

<template>
  <div
    class="h-full w-full flex flex-col overflow-hidden bg-background text-foreground m-0 p-0"
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
        :app-update-available="updateAvailable"
        @update:active-tab="activeTab = $event"
        @add-job="addManualJob"
        @smart-scan="startSmartScan"
      />

      <!-- 主内容区作为 flex 子项必须设置 min-w-0，避免内部长内容把整体布局撑宽，导致侧边栏被挤压 -->
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
          @update:manualJobPresetId="(v) => (manualJobPresetId = v)"
          @update:queueViewModeModel="(v) => (queueViewModeModel = v as any)"
          @openPresetWizard="dialogManager.openWizard()"
        />

        <MainGlobalAlerts
          :queue-error="queueError"
          :media-inspect-error="mediaInspectError"
          :settings-save-error="settingsSaveError"
          @clearQueueError="queueError = null"
          @clearMediaInspectError="mediaInspectError = null"
          @clearSettingsSaveError="settingsSaveError = null"
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
          :total-count="jobs.length"
          :selection-bar-pinned="selectionBarPinned"
          @update:queueMode="(v) => setQueueMode(v as any)"
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

        <ScrollArea class="flex-1">
          <div class="p-4 min-h-full">
            <QueuePanel
              v-if="activeTab === 'queue'"
              v-bind="queuePanelProps"
              @update:queue-view-mode="setQueueViewMode"
              @update:queue-mode="setQueueMode"
              @update:queue-progress-style="setQueueProgressStyle"
              @add-job="addManualJob"
              @cancel-job="handleCancelJob"
              @wait-job="handleWaitJob"
              @resume-job="handleResumeJob"
              @restart-job="handleRestartJob"
              @toggle-job-selected="toggleJobSelected"
              @inspect-job="dialogManager.openJobDetail"
              @preview-job="openJobPreviewFromQueue"
              @toggle-batch-expanded="toggleBatchExpanded"
              @open-batch-detail="openBatchDetail"
              @open-job-context-menu="openQueueContextMenuForJob"
              @open-bulk-context-menu="openQueueContextMenuForBulk"
            />

            <PresetPanel
              v-else-if="activeTab === 'presets'"
              :presets="presets"
              :sort-mode="presetSortMode"
              :view-mode="presetViewMode"
              @edit="openPresetEditor"
              @delete="requestDeletePreset"
              @reorder="handleReorderPresets"
              @importSmartPack="dialogManager.openSmartPresetImport()"
              @update:sortMode="(v) => (presetSortMode = v)"
              @update:viewMode="(v) => (presetViewMode = v)"
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

            <MonitorPanelPro v-else-if="activeTab === 'monitor'" />

            <SettingsPanel
              v-else-if="activeTab === 'settings'"
              :app-settings="appSettings"
              :tool-statuses="toolStatuses"
              :tool-statuses-fresh="toolStatusesFresh"
              :refresh-tool-statuses="settings.refreshToolStatuses"
              :is-saving-settings="isSavingSettings"
              :settings-save-error="settingsSaveError"
              :app-update="{
                configured: updaterConfigured,
                autoCheckDefault,
                available: updateAvailable,
                checking: isCheckingForUpdate,
                installing: isInstallingUpdate,
                availableVersion,
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
      :queue-mode="queueMode"
      :has-selection="hasSelection"
      :can-reveal-input-path="queueContextMenuCanRevealInputPath"
      :can-reveal-output-path="queueContextMenuCanRevealOutputPath"
      @inspect="handleQueueContextInspect"
      @wait="handleQueueContextWait"
      @resume="handleQueueContextResume"
      @restart="handleQueueContextRestart"
      @cancel="handleQueueContextCancel"
      @move-to-top="handleQueueContextMoveToTop"
      @move-to-bottom="handleQueueContextMoveToBottom"
      @remove="handleQueueContextDelete"
      @open-input-folder="handleQueueContextOpenInputFolder"
      @open-output-folder="handleQueueContextOpenOutputFolder"
      @close="closeQueueContextMenu"
    />

    <MainDialogsStack
      :dialog-manager="dialogManager"
      :presets="presets"
      :preset-pending-delete="presetPendingDelete"
      :smart-config="smartConfig"
      :default-video-preset-id="manualJobPresetId"
      :queue-progress-style="queueProgressStyle"
      :progress-update-interval-ms="progressUpdateIntervalMs"
      :selected-job-preset="selectedJobPreset"
      :job-detail-log-text="jobDetailLogText"
      :highlighted-log-html="highlightedLogHtml"
      :preview-url="previewUrl"
      :preview-is-image="previewIsImage"
      :preview-error="previewError"
      :ffmpeg-resolved-path="ffmpegResolvedPath"
      :sort-compare-fn="compareJobsForDisplay"
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
      @handleWaitJob="handleWaitJob"
      @handleResumeJob="handleResumeJob"
      @handleRestartJob="handleRestartJob"
      @closeBatchDetail="dialogManager.closeBatchDetail()"
      @handleExpandedPreviewError="handleExpandedPreviewError"
      @handleExpandedImagePreviewError="handleExpandedImagePreviewError"
      @closeExpandedPreview="closeExpandedPreview"
      @openPreviewInSystemPlayer="openPreviewInSystemPlayer"
      @importSmartPackConfirmed="handleImportSmartPackConfirmed"
      @openToolsSettings="activeTab = 'settings'"
    />
  </div>
</template>
