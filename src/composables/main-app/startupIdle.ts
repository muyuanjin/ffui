export interface StartupIdleScheduleOptions {
  /** Timeout for requestIdleCallback (ms). */
  timeoutMs: number;
  /** Optional window override for tests. */
  win?: Window & typeof globalThis;
}

/**
 * Schedule a callback behind the startup idle gate. When requestIdleCallback is
 * available we use it with a bounded timeout so startup work cannot be
 * starved indefinitely under sustained load. Otherwise we fall back to
 * setTimeout(0).
 */
export function scheduleStartupIdle(cb: () => void, options: StartupIdleScheduleOptions): void {
  const win = options.win ?? (typeof window !== "undefined" ? window : undefined);
  if (!win) {
    cb();
    return;
  }

  const anyWindow = win as any;
  if (typeof anyWindow.requestIdleCallback === "function") {
    anyWindow.requestIdleCallback(cb, { timeout: options.timeoutMs });
  } else {
    win.setTimeout(cb, 0);
  }
}
