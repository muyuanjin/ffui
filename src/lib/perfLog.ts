const perfLoggingEnabled = (() => {
  if (typeof import.meta === "undefined") return false;
  const env = typeof import.meta.env === "undefined" ? null : import.meta.env;
  if (!env) return false;
  return Boolean(env.DEV || env.VITE_LOG_PERF === "1");
})();

export const isPerfLoggingEnabled = perfLoggingEnabled;

export function perfLog(...args: unknown[]) {
  if (!perfLoggingEnabled) return;
  if (typeof console === "undefined" || typeof console.log !== "function") return;
  console.log(...args);
}
