import { invokeWithAliases } from "./backend/invokeWithAliases";
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
  return invokeWithAliases<DataRootInfo>("get_data_root_info");
};

export const setDataRootMode = async (mode: DataRootMode): Promise<DataRootInfo> => {
  requireTauri("setDataRootMode");
  return invokeWithAliases<DataRootInfo>("set_data_root_mode", { mode });
};

export const acknowledgeDataRootFallbackNotice = async (): Promise<boolean> => {
  if (!hasTauri()) return false;
  return invokeWithAliases<boolean>("acknowledge_data_root_fallback_notice");
};

export const openDataRootDir = async (): Promise<void> => {
  requireTauri("openDataRootDir");
  await invokeWithAliases<void>("open_data_root_dir");
};

export const exportConfigBundle = async (targetPath: string): Promise<ConfigBundleExportResult> => {
  requireTauri("exportConfigBundle");
  const normalized = targetPath.trim();
  if (!normalized) {
    throw new Error("export path is empty");
  }
  return invokeWithAliases<ConfigBundleExportResult>("export_config_bundle", {
    targetPath: normalized,
  });
};

export const importConfigBundle = async (sourcePath: string): Promise<ConfigBundleImportResult> => {
  requireTauri("importConfigBundle");
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("import path is empty");
  }
  return invokeWithAliases<ConfigBundleImportResult>("import_config_bundle", {
    sourcePath: normalized,
  });
};

export const clearAllAppData = async (): Promise<AppSettings> => {
  requireTauri("clearAllAppData");
  return invokeWithAliases<AppSettings>("clear_all_app_data");
};
