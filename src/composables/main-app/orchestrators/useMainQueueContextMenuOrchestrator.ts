import { computed, proxyRefs } from "vue";
import { useQueueDomain } from "@/MainApp.setup";

export function useMainQueueContextMenuOrchestrator() {
  const queue = proxyRefs(useQueueDomain());
  const menu = proxyRefs(queue.queueContextMenu);

  const menuProps = proxyRefs({
    visible: computed(() => menu.queueContextMenuVisible),
    x: computed(() => menu.queueContextMenuX),
    y: computed(() => menu.queueContextMenuY),
    mode: computed(() => menu.queueContextMenuMode),
    jobStatus: computed(() => menu.queueContextMenuJobStatus),
    jobType: computed(() => menu.queueContextMenuJob?.type),
    queueMode: computed(() => queue.queueMode),
    hasSelection: computed(() => queue.hasSelection),
    bulkActionInProgress: computed(() => queue.bulkActionInProgress),
    canRevealInputPath: computed(() => menu.queueContextMenuCanRevealInputPath),
    canRevealOutputPath: computed(() => menu.queueContextMenuCanRevealOutputPath),
  });

  const menuListeners = {
    inspect: menu.handleQueueContextInspect,
    compare: menu.handleQueueContextCompare,
    wait: menu.handleQueueContextWait,
    resume: menu.handleQueueContextResume,
    restart: menu.handleQueueContextRestart,
    cancel: menu.handleQueueContextCancel,
    "move-to-top": menu.handleQueueContextMoveToTop,
    "move-to-bottom": menu.handleQueueContextMoveToBottom,
    remove: menu.handleQueueContextDelete,
    "open-input-folder": menu.handleQueueContextOpenInputFolder,
    "open-output-folder": menu.handleQueueContextOpenOutputFolder,
    "copy-input-path": menu.handleQueueContextCopyInputPath,
    "copy-output-path": menu.handleQueueContextCopyOutputPath,
    close: menu.closeQueueContextMenu,
  } as const;

  return { menuProps, menuListeners };
}
