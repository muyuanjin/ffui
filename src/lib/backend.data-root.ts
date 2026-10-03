import { invokeCommand } from "./backend/invokeCommand";
import type {
  AppSettings,
  ConfigBundleExportResult,
  ConfigBundleImportResult,
  DataRootInfo,
  DataRootMode,
} from "../types";
import { hasTauri, requireTauri } from "./backend.core";
import { acceptSettingsReplacement, withSettingsOperation, type SettingsSnapshot } from "./backend.settings";

export const fetchDataRootInfo = async (): Promise<DataRootInfo> => {
  requireTauri("fetchDataRootInfo");
  return invokeCommand<DataRootInfo>("get_data_root_info");
};

export const setDataRootMode = async (mode: DataRootMode): Promise<DataRootInfo> => {
  requireTauri("setDataRootMode");
  return withSettingsOperation(() => invokeCommand<DataRootInfo>("set_data_root_mode", { mode }));
};

export const acknowledgeDataRootFallbackNotice = async (): Promise<boolean> => {
  if (!hasTauri()) return false;
  return invokeCommand<boolean>("acknowledge_data_root_fallback_notice");
};

export const openDataRootDir = async (): Promise<void> => {
  requireTauri("openDataRootDir");
  await invokeCommand<void>("open_data_root_dir");
};

export const exportConfigBundle = async (targetPath: string): Promise<ConfigBundleExportResult> => {
  requireTauri("exportConfigBundle");
  const normalized = targetPath.trim();
  if (!normalized) {
    throw new Error("export path is empty");
  }
  return withSettingsOperation(() =>
    invokeCommand<ConfigBundleExportResult>("export_config_bundle", {
      targetPath: normalized,
    }),
  );
};

export const importConfigBundle = async (sourcePath: string): Promise<ConfigBundleImportResult> => {
  requireTauri("importConfigBundle");
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("import path is empty");
  }
  return withSettingsOperation(async () => {
    const result = await invokeCommand<Omit<ConfigBundleImportResult, "settings"> & { settings: SettingsSnapshot }>(
      "import_config_bundle",
      {
        sourcePath: normalized,
      },
    );
    return { ...result, settings: acceptSettingsReplacement(result.settings) };
  });
};

export const clearAllAppData = async (): Promise<AppSettings> => {
  requireTauri("clearAllAppData");
  return withSettingsOperation(async () =>
    acceptSettingsReplacement(await invokeCommand<SettingsSnapshot>("clear_all_app_data")),
  );
};
