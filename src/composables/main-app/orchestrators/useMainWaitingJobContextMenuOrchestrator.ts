import { computed, proxyRefs } from "vue";
import { useQueueDomain } from "@/MainApp.setup";

export function useMainWaitingJobContextMenuOrchestrator() {
  const queue = useQueueDomain();
  const dnd = proxyRefs(queue.dnd);

  const menuProps = proxyRefs({
    visible: computed(() => dnd.waitingJobContextMenuVisible),
  });

  const menuListeners = {
    "move-to-top": dnd.handleWaitingJobContextMoveToTop,
    close: dnd.closeWaitingJobContextMenu,
  } as const;

  return { menuProps, menuListeners };
}
