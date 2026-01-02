import type { PresetSortMode } from "@/types";

export const PRESET_SORT_OPTIONS: ReadonlyArray<{ value: PresetSortMode; labelKey: string }> = [
  { value: "manual", labelKey: "presets.sortManual" },
  { value: "usage", labelKey: "presets.sortUsage" },
  { value: "inputSize", labelKey: "presets.sortInputSize" },
  { value: "createdTime", labelKey: "presets.sortCreatedTime" },
  { value: "ratio", labelKey: "presets.sortRatio" },
  { value: "vmaf", labelKey: "presets.sortVmaf" },
  { value: "speed", labelKey: "presets.sortSpeed" },
  { value: "name", labelKey: "presets.sortName" },
];
