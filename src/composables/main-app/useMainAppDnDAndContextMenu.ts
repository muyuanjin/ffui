import { ref, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { useDragAndDrop, type UseDragAndDropOptions } from "@/composables";
import type { MainAppTab } from "./useMainAppShell";

export interface UseMainAppDnDAndContextMenuOptions {
  activeTab: Ref<MainAppTab>;
  inspectMediaForPath: (path: string) => Promise<void>;
  enqueueManualJobsFromPaths: (paths: string[]) => Promise<void>;
  selectedJobIds: Ref<Set<string>>;
  bulkMoveSelectedJobsToTopInner: () => Promise<void>;
}

export interface UseMainAppDnDAndContextMenuReturn {
  isDragging: Ref<boolean>;
  handleDragOver: (e: DragEvent) => void;
  handleDragLeave: () => void;
  handleDrop: (e: DragEvent) => void;
  waitingJobContextMenuVisible: Ref<boolean>;
  waitingJobContextMenuJobId: Ref<string | null>;
  openWaitingJobContextMenu: (job: TranscodeJob, event: MouseEvent) => void;
  closeWaitingJobContextMenu: () => void;
  handleWaitingJobContextMoveToTop: () => Promise<void>;
}

/**
 * Drag & drop wiring plus the small waiting-row context menu helpers that
 * tests exercise directly on the MainApp instance.
 */
export function useMainAppDnDAndContextMenu(
  options: UseMainAppDnDAndContextMenuOptions,
): UseMainAppDnDAndContextMenuReturn {
  const {
    activeTab,
    inspectMediaForPath,
    enqueueManualJobsFromPaths,
    selectedJobIds,
    bulkMoveSelectedJobsToTopInner,
  } = options;

  const handleTauriFileDrop = async (paths: string[]) => {
    if (!paths || paths.length === 0) return;

    if (activeTab.value === "media") {
      const first = paths[0];
      if (typeof first === "string" && first) {
        await inspectMediaForPath(first);
      }
      return;
    }

    await enqueueManualJobsFromPaths(paths);
  };

  const dragOptions: UseDragAndDropOptions = {
    onFilesDropped: (paths) => {
      void handleTauriFileDrop(paths);
    },
  };

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragAndDrop(dragOptions);

  const waitingJobContextMenuVisible = ref(false);
  const waitingJobContextMenuJobId = ref<string | null>(null);

  const openWaitingJobContextMenu = (job: TranscodeJob, _event: MouseEvent) => {
    if (!job?.id) return;
    waitingJobContextMenuVisible.value = true;
    waitingJobContextMenuJobId.value = job.id;
  };
  void openWaitingJobContextMenu;

  const closeWaitingJobContextMenu = () => {
    waitingJobContextMenuVisible.value = false;
    waitingJobContextMenuJobId.value = null;
  };

  const handleWaitingJobContextMoveToTop = async () => {
    const jobId = waitingJobContextMenuJobId.value;
    if (!jobId) return;

    selectedJobIds.value = new Set([jobId]);
    await bulkMoveSelectedJobsToTopInner();
    closeWaitingJobContextMenu();
  };

  return {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    waitingJobContextMenuVisible,
    waitingJobContextMenuJobId,
    openWaitingJobContextMenu,
    closeWaitingJobContextMenu,
    handleWaitingJobContextMoveToTop,
  };
}

export default useMainAppDnDAndContextMenu;
