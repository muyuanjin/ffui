import { onBeforeUnmount, onMounted, type ComputedRef, type Ref } from "vue";

const shouldIgnoreClearSelectionFromTarget = (target: Element): boolean => {
  return Boolean(
    target.closest(
      [
        // Interactive controls / overlays
        "button",
        "a",
        "input",
        "textarea",
        "select",
        '[role="button"]',
        '[role="menu"]',
        '[role="menuitem"]',
        '[role="dialog"]',
        "[data-stop-clear-selection]",

        // Queue items/cards
        '[data-testid="queue-item-card"]',
        '[data-testid="queue-icon-item"]',
        '[data-testid="queue-icon-batch-item"]',
        '[data-testid="batch-compress-batch-card"]',
        '[data-testid="ffui-carousel-3d-card"]',
      ].join(","),
    ),
  );
};

export function useQueueBlankClickClearSelection(options: {
  activeTab: Ref<string>;
  hasSelection: ComputedRef<boolean> | Ref<boolean>;
  clearSelection: () => void;
}): {
  handleGlobalBlankClick: (event: MouseEvent) => void;
  handleGlobalBlankPointerDown: (event: PointerEvent) => void;
} {
  const handleEvent = (event: MouseEvent) => {
    if (options.activeTab.value !== "queue") return;
    if (!options.hasSelection.value) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (shouldIgnoreClearSelectionFromTarget(target)) return;
    options.clearSelection();
  };

  const handleGlobalBlankClick = (event: MouseEvent) => handleEvent(event);
  const handleGlobalBlankPointerDown = (event: PointerEvent) => handleEvent(event);

  onMounted(() => {
    document.addEventListener("pointerdown", handleGlobalBlankPointerDown, true);
    document.addEventListener("click", handleGlobalBlankClick, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleGlobalBlankPointerDown, true);
    document.removeEventListener("click", handleGlobalBlankClick, true);
  });

  return { handleGlobalBlankClick, handleGlobalBlankPointerDown };
}
