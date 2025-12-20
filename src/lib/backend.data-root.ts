import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ConfigBundleExportResult,
  ConfigBundleImportResult,
  DataRootInfo,
  DataRootMode,
} from "../types";
import { hasTauri, requireTauri } from "./backend.core";

export const fetchDataRootInfo = async (): Promise<DataRootInfo> => {
  requireTauri("fetchDataRootInfo");
  return invoke<DataRootInfo>("get_data_root_info");
};

export const setDataRootMode = async (mode: DataRootMode): Promise<DataRootInfo> => {
  requireTauri("setDataRootMode");
  return invoke<DataRootInfo>("set_data_root_mode", { mode });
};

export const acknowledgeDataRootFallbackNotice = async (): Promise<boolean> => {
  if (!hasTauri()) return false;
  return invoke<boolean>("acknowledge_data_root_fallback_notice");
};

export const openDataRootDir = async (): Promise<void> => {
  requireTauri("openDataRootDir");
  await invoke<void>("open_data_root_dir");
};

export const exportConfigBundle = async (targetPath: string): Promise<ConfigBundleExportResult> => {
  requireTauri("exportConfigBundle");
  const normalized = targetPath.trim();
  if (!normalized) {
    throw new Error("export path is empty");
  }
  return invoke<ConfigBundleExportResult>("export_config_bundle", {
    targetPath: normalized,
    target_path: normalized,
  });
};

export const importConfigBundle = async (sourcePath: string): Promise<ConfigBundleImportResult> => {
  requireTauri("importConfigBundle");
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("import path is empty");
  }
  return invoke<ConfigBundleImportResult>("import_config_bundle", {
    sourcePath: normalized,
    source_path: normalized,
  });
};

export const clearAllAppData = async (): Promise<AppSettings> => {
  requireTauri("clearAllAppData");
  return invoke<AppSettings>("clear_all_app_data");
};
