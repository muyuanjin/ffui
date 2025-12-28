import type { PresetSortMode, PresetViewMode } from "@/types";

export const PRESET_SORT_MODES: PresetSortMode[] = ["manual", "usage", "inputSize", "ratio", "speed", "name"];
export const PRESET_VIEW_MODES: PresetViewMode[] = ["grid", "compact"];

export const normalizePresetSortMode = (value: unknown, fallback: PresetSortMode): PresetSortMode => {
  return typeof value === "string" && PRESET_SORT_MODES.includes(value as PresetSortMode)
    ? (value as PresetSortMode)
    : fallback;
};

export const normalizePresetViewMode = (value: unknown, fallback: PresetViewMode): PresetViewMode => {
  return typeof value === "string" && PRESET_VIEW_MODES.includes(value as PresetViewMode)
    ? (value as PresetViewMode)
    : fallback;
};
