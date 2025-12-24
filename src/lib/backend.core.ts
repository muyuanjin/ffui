export const hasTauri = () => {
  if (typeof window === "undefined") return false;
  // Tauri v2 webview exposes `__TAURI_INTERNALS__` for the JS API bindings.
  // `__TAURI__` exists only when `withGlobalTauri` is enabled, and older
  // builds might expose `__TAURI_IPC__`. Treat any of them as a Tauri runtime.
  return "__TAURI_INTERNALS__" in window || "__TAURI_IPC__" in window || "__TAURI__" in window;
};

export const requireTauri = (label: string) => {
  if (!hasTauri()) {
    throw new Error(`${label} requires Tauri`);
  }
};
