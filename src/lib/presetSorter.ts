import type { FFmpegPreset, PresetSortMode } from "@/types";

/**
 * 计算预设的平均压缩率（输出体积 / 输入体积 * 100）
 *
 * 返回值示例：
 * - 50  表示输出体积约为原始体积的 50%
 * - 80  表示输出体积约为原始体积的 80%
 * - 120 表示输出体积约为原始体积的 120%（变大了）
 */
export function getPresetAvgRatio(preset: FFmpegPreset): number | null {
  const input = preset.stats.totalInputSizeMB;
  const output = preset.stats.totalOutputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) return null;
  const ratio = (output / input) * 100;
  return ratio;
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
 * 计算预设的平均处理 FPS (frames/s)
 */
export function getPresetAvgFps(preset: FFmpegPreset): number | null {
  const frames = preset.stats.totalFrames ?? 0;
  const time = preset.stats.totalTimeSeconds;
  if (!frames || !time || time <= 0) return null;
  return frames / time;
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
    case "inputSize":
      sorted.sort((a, b) => {
        const sizeA = a.stats.totalInputSizeMB > 0 ? a.stats.totalInputSizeMB : null;
        const sizeB = b.stats.totalInputSizeMB > 0 ? b.stats.totalInputSizeMB : null;
        if (sizeA == null && sizeB == null) return 0;
        if (sizeA == null) return 1;
        if (sizeB == null) return -1;
        return sizeB - sizeA;
      });
      break;
    case "ratio":
      sorted.sort((a, b) => {
        const ratioA = getPresetAvgRatio(a);
        const ratioB = getPresetAvgRatio(b);
        // 无统计数据的预设排在后面
        if (ratioA == null && ratioB == null) return 0;
        if (ratioA == null) return 1;
        if (ratioB == null) return -1;
        // 压缩率越小表示输出体积越小，压缩效率越高
        return ratioA - ratioB;
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
