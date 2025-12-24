import { invoke } from "@tauri-apps/api/core";
import type { AppUpdaterCapabilities } from "./backend.types";

const hasTauri = () => {
  if (typeof window === "undefined") return false;
  // In Tauri 2, `__TAURI_IPC__` is always present in the webview. `__TAURI__`
  // exists only when `withGlobalTauri` is enabled. We treat either as Tauri.
  return "__TAURI_IPC__" in window || "__TAURI__" in window;
};

export const fetchAppUpdaterCapabilities = async (): Promise<AppUpdaterCapabilities> => {
  if (!hasTauri()) return { configured: false };
  return invoke<AppUpdaterCapabilities>("get_app_updater_capabilities");
};

export const prepareAppUpdaterProxy = async (): Promise<string | null> => {
  if (!hasTauri()) return null;
  return invoke<string | null>("prepare_app_updater_proxy");
};
