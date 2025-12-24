export const startupNowMs = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

export const updateStartupMetrics = (patch: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  const current = window.__FFUI_STARTUP_METRICS__ ?? {};
  window.__FFUI_STARTUP_METRICS__ = Object.assign({}, current, patch);
};
