import type { FFmpegPreset, PresetSortMode } from "@/types";

/**
 * 计算预设的平均压缩率
 */
export function getPresetAvgRatio(preset: FFmpegPreset): number | null {
  const input = preset.stats.totalInputSizeMB;
  const output = preset.stats.totalOutputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) return null;
  const ratio = (1 - output / input) * 100;
  return Math.max(Math.min(ratio, 100), -100);
}

/**
 * 计算预设的平均处理速度 (MB/s)
 */
export function getPresetAvgSpeed(preset: FFmpegPreset): number | null {
  const input = preset.stats.totalInputSizeMB;
  const time = preset.stats.totalTimeSeconds;
  if (!input || !time || time <= 0) return null;
  return input / time;
}

/**
 * 根据排序模式对预设列表进行排序
 * @param presets 原始预设列表
 * @param sortMode 排序模式
 * @returns 排序后的预设列表（新数组，不修改原数组）
 */
export function sortPresets(presets: FFmpegPreset[], sortMode: PresetSortMode): FFmpegPreset[] {
  if (sortMode === "manual") {
    return presets;
  }

  const sorted = [...presets];
  switch (sortMode) {
    case "usage":
      sorted.sort((a, b) => b.stats.usageCount - a.stats.usageCount);
      break;
    case "ratio":
      sorted.sort((a, b) => {
        const ratioA = getPresetAvgRatio(a) ?? -Infinity;
        const ratioB = getPresetAvgRatio(b) ?? -Infinity;
        return ratioB - ratioA;
      });
      break;
    case "speed":
      sorted.sort((a, b) => {
        const speedA = getPresetAvgSpeed(a) ?? -Infinity;
        const speedB = getPresetAvgSpeed(b) ?? -Infinity;
        return speedB - speedA;
      });
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      break;
  }
  return sorted;
}
