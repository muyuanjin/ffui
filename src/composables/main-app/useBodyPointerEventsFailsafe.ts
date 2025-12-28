import { onBeforeUnmount, watch, type ComputedRef, type Ref } from "vue";

type BoolRef = Ref<boolean> | ComputedRef<boolean>;

/**
 * Best-effort safety net: if a modal/menu layer fails to restore
 * `document.body.style.pointerEvents` (stuck at `none`), the entire UI becomes
 * non-interactive. This guard restores the original value once the app believes
 * no blocking overlay should be active.
 */
export function useBodyPointerEventsFailsafe(options: { hasBlockingOverlay: BoolRef; intervalMs?: number }) {
  const baselinePointerEvents = typeof document !== "undefined" ? document.body.style.pointerEvents : "";
  const intervalMs =
    typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : 50;

  const checkTimeouts: number[] = [];

  const clearTimers = () => {
    while (checkTimeouts.length > 0) {
      const id = checkTimeouts.pop();
      if (id != null) window.clearTimeout(id);
    }
  };

  const restoreIfStuck = () => {
    if (typeof document === "undefined") return;
    if (options.hasBlockingOverlay.value) return;
    if (document.body.style.pointerEvents !== "none") return;
    document.body.style.pointerEvents = baselinePointerEvents;
  };

  watch(
    () => options.hasBlockingOverlay.value,
    (hasBlockingOverlay) => {
      clearTimers();
      if (hasBlockingOverlay) return;
      // Defer and retry a few times so component unmount cleanups get a chance
      // to run before we forcefully restore pointer-events.
      const delays = [0, intervalMs, intervalMs * 5, intervalMs * 20];
      for (const delay of delays) {
        checkTimeouts.push(window.setTimeout(restoreIfStuck, delay));
      }
    },
    { flush: "post", immediate: true },
  );

  onBeforeUnmount(() => clearTimers());
}
