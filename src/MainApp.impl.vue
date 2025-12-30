<script setup lang="ts">
import { proxyRefs } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import TitleBar from "@/components/TitleBar.vue";
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
import { useMainAppRootOrchestrator } from "@/composables/main-app/orchestrators/useMainAppRootOrchestrator";

const setup = createMainAppContext();
provideMainAppContext(setup);

const root = useMainAppRootOrchestrator(setup);
const shell = proxyRefs(root.shell);
const dnd = proxyRefs(root.dnd);
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
    <TitleBar v-bind="root.titleBarProps" v-on="root.titleBarListeners" />
    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">
      <Sidebar v-bind="root.sidebarProps" v-on="root.sidebarListeners" />
      <main class="flex-1 flex min-h-0 min-w-0 flex-col bg-background">
        <MainContentHeaderHost />
        <MainQueueFiltersBarHost />
        <MainGlobalAlerts v-bind="root.globalAlertsProps" v-on="root.globalAlertsListeners" />
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
    <MainDialogsStackHost @openToolsSettings="root.openToolsSettings" />
  </div>
</template>
