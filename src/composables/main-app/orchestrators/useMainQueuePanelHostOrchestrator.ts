import { computed } from "vue";
import { useQueueDomain, useShellDomain } from "@/MainApp.setup";
import { useQueuePanelOrchestrator } from "@/composables/main-app/orchestrators/useQueuePanelOrchestrator";

export function useMainQueuePanelHostOrchestrator() {
  const shell = useShellDomain();
  const queue = useQueueDomain();
  const orchestrator = useQueuePanelOrchestrator();

  const panelVisible = computed(() => shell.activeTab.value === "queue");

  const panelProps = queue.queuePanelProps;

  const panelListeners = {
    "update:queueViewMode": queue.setQueueViewMode,
    "update:queueMode": queue.setQueueMode,
    "update:queueProgressStyle": queue.setQueueProgressStyle,
    addJobFiles: orchestrator.addManualJobsFromFiles,
    addJobFolder: orchestrator.addManualJobsFromFolder,
    cancelJob: queue.handleCancelJob,
    waitJob: queue.handleWaitJob,
    resumeJob: queue.handleResumeJob,
    restartJob: queue.handleRestartJob,
    toggleJobSelected: queue.toggleJobSelected,
    inspectJob: orchestrator.inspectJob,
    previewJob: orchestrator.previewJob,
    compareJob: orchestrator.compareJob,
    toggleBatchExpanded: orchestrator.toggleBatchExpanded,
    openBatchDetail: orchestrator.openBatchDetail,
    openJobContextMenu: orchestrator.openJobContextMenu,
    openBulkContextMenu: orchestrator.openBulkContextMenu,
  } as const;

  return {
    panelVisible,
    panelProps,
    panelListeners,
  };
}
