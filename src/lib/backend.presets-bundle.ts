import { invoke } from "@tauri-apps/api/core";
import type { PresetBundle, PresetBundleExportResult } from "../types";
import { requireTauri } from "./backend.core";

export const exportPresetsBundle = async (
  targetPath: string,
  presetIds: string[],
): Promise<PresetBundleExportResult> => {
  requireTauri("exportPresetsBundle");
  const normalized = targetPath.trim();
  if (!normalized) {
    throw new Error("export path is empty");
  }
  const ids = (presetIds ?? []).filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (ids.length === 0) {
    throw new Error("no presets selected");
  }
  return invoke<PresetBundleExportResult>("export_presets_bundle", {
    targetPath: normalized,
    target_path: normalized,
    presetIds: ids,
    preset_ids: ids,
  });
};

export const readPresetsBundle = async (sourcePath: string): Promise<PresetBundle> => {
  requireTauri("readPresetsBundle");
  const normalized = sourcePath.trim();
  if (!normalized) {
    throw new Error("import path is empty");
  }
  return invoke<PresetBundle>("read_presets_bundle", {
    sourcePath: normalized,
    source_path: normalized,
  });
};
