const LISTENER_OPTIONS = { capture: true } as const;

let refCount = 0;
let handler: ((event: MouseEvent) => void) | null = null;

/**
 * Disable the native (webview/browser) context menu everywhere.
 * Custom in-app context menus can still work via their own event handlers.
 */
export const installNativeContextMenuGuard = (): (() => void) => {
  if (typeof document === "undefined") return () => {};

  if (!handler) {
    handler = (event: MouseEvent) => {
      if (!event.cancelable) return;
      event.preventDefault();
    };
  }

  if (refCount === 0) {
    document.addEventListener("contextmenu", handler, LISTENER_OPTIONS);
  }

  refCount += 1;

  return () => {
    if (typeof document === "undefined" || !handler) return;

    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      document.removeEventListener("contextmenu", handler, LISTENER_OPTIONS);
    }
  };
};
