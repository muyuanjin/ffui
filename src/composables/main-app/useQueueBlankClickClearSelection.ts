import type { ComputedRef, Ref } from "vue";

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

  return { handleGlobalBlankClick, handleGlobalBlankPointerDown };
}
