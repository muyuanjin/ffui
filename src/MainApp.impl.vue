<script setup lang="ts">
import { proxyRefs } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import TitleBar from "@/components/TitleBar.vue";
import { deriveProgressTransitionMs } from "@/lib/progressTransition";
import Sidebar from "@/components/Sidebar.vue";
import { MonitorPanelPro } from "@/components/main/lazyTabs";
import MainContentHeaderHost from "@/components/main/MainContentHeaderHost.vue";
import MainDialogsStackHost from "@/components/main/MainDialogsStackHost.vue";
import MainMediaTabHost from "@/components/main/MainMediaTabHost.vue";
import MainQueueContextMenuHost from "@/components/main/MainQueueContextMenuHost.vue";
import MainQueueFiltersBarHost from "@/components/main/MainQueueFiltersBarHost.vue";
import MainQueuePanelHost from "@/components/main/MainQueuePanelHost.vue";
import MainPresetsTabHost from "@/components/main/MainPresetsTabHost.vue";
import MainSettingsTabHost from "@/components/main/MainSettingsTabHost.vue";
import MainWaitingJobContextMenuHost from "@/components/main/MainWaitingJobContextMenuHost.vue";
import MainDragOverlay from "@/components/main/MainDragOverlay.vue";
import MainGlobalAlerts from "@/components/main/MainGlobalAlerts.vue";
import { createMainAppContext, provideMainAppContext } from "@/MainApp.setup";
import { useLocalePersistence } from "@/composables/main-app/useLocalePersistence";
import { useQueueBlankClickClearSelection } from "@/composables/main-app/useQueueBlankClickClearSelection";

const setup = createMainAppContext();
provideMainAppContext(setup);

const app = proxyRefs(setup);

const shell = proxyRefs(setup.shell);
const batchCompress = setup.batchCompress;
const presetsModule = setup.presetsModule;
const media = setup.media;
const settings = setup.settings;
const settingsVm = proxyRefs(settings);
const updater = setup.updater;
const updaterVm = proxyRefs(updater);
const dnd = proxyRefs(setup.dnd);

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
        <MainContentHeaderHost />
        <MainQueueFiltersBarHost />
        <MainGlobalAlerts
          :queue-error="app.queueError"
          :media-inspect-error="media.mediaInspectError.value"
          :settings-save-error="settingsVm.settingsSaveError"
          @clearQueueError="app.queueError = null"
          @clearMediaInspectError="clearMediaInspectError"
          @clearSettingsSaveError="settingsVm.settingsSaveError = null"
        />
        <MainQueuePanelHost />
        <ScrollArea v-if="shell.activeTab !== 'queue'" class="flex-1 min-h-0">
          <div class="min-h-full flex flex-col" :class="shell.activeTab === 'presets' ? undefined : 'p-4'">
            <MainPresetsTabHost v-if="shell.activeTab === 'presets'" />
            <MainMediaTabHost v-else-if="shell.activeTab === 'media'" />
            <MonitorPanelPro v-else-if="shell.activeTab === 'monitor'" />
            <MainSettingsTabHost v-else-if="shell.activeTab === 'settings'" />
          </div>
        </ScrollArea>
      </main>
    </div>
    <MainWaitingJobContextMenuHost />
    <MainQueueContextMenuHost />
    <MainDialogsStackHost @openToolsSettings="shell.activeTab = 'settings'" />
  </div>
</template>
