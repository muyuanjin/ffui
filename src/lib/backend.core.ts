export const hasTauri = () => {
  if (typeof window === "undefined") return false;
  // In Tauri 2, `__TAURI_IPC__` is always present in the webview. `__TAURI__`
  // exists only when `withGlobalTauri` is enabled. We treat either as Tauri.
  return "__TAURI_IPC__" in window || "__TAURI__" in window;
};

export const requireTauri = (label: string) => {
  if (!hasTauri()) {
    throw new Error(`${label} requires Tauri`);
  }
};
