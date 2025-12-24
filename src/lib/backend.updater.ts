import { invoke } from "@tauri-apps/api/core";
import type { AppUpdaterCapabilities } from "./backend.types";
import { hasTauri } from "./backend.core";

export const fetchAppUpdaterCapabilities = async (): Promise<AppUpdaterCapabilities> => {
  if (!hasTauri()) return { configured: false };
  return invoke<AppUpdaterCapabilities>("get_app_updater_capabilities");
};

export const prepareAppUpdaterProxy = async (): Promise<string | null> => {
  if (!hasTauri()) return null;
  return invoke<string | null>("prepare_app_updater_proxy");
};
