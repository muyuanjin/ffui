import type { FFmpegPreset, PresetSortDirection, PresetSortMode } from "@/types";

export function getDefaultPresetSortDirection(sortMode: PresetSortMode): PresetSortDirection {
  switch (sortMode) {
    case "ratio":
    case "name":
      return "asc";
    case "manual":
    case "usage":
    case "inputSize":
    case "createdTime":
    case "vmaf":
    case "speed":
    default:
      return "desc";
  }
}

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
 * 计算预设的平均 VMAF（聚合的 vmafSum / vmafCount）
 */
export function getPresetAvgVmaf(preset: FFmpegPreset): number | null {
  const c = Number(preset.stats.vmafCount ?? 0);
  const sum = Number(preset.stats.vmafSum ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(sum)) return null;
  return sum / c;
}

/**
 * 根据排序模式对预设列表进行排序
 * @param presets 原始预设列表
 * @param sortMode 排序模式
 * @param options 可选辅助数据（仅用于部分排序模式）
 * @returns 排序后的预设列表（新数组，不修改原数组）
 */
export function sortPresets(
  presets: FFmpegPreset[],
  sortMode: PresetSortMode,
  options?: {
    predictedVmafByPresetId?: ReadonlyMap<string, number | null>;
    direction?: PresetSortDirection;
  },
): FFmpegPreset[] {
  if (sortMode === "manual") {
    return presets;
  }

  const sorted = [...presets];
  const direction = options?.direction ?? getDefaultPresetSortDirection(sortMode);
  switch (sortMode) {
    case "usage":
      sorted.sort((a, b) =>
        direction === "asc" ? a.stats.usageCount - b.stats.usageCount : b.stats.usageCount - a.stats.usageCount,
      );
      break;
    case "inputSize":
      sorted.sort((a, b) => {
        const sizeA = a.stats.totalInputSizeMB > 0 ? a.stats.totalInputSizeMB : null;
        const sizeB = b.stats.totalInputSizeMB > 0 ? b.stats.totalInputSizeMB : null;
        if (sizeA == null && sizeB == null) return 0;
        if (sizeA == null) return 1;
        if (sizeB == null) return -1;
        return direction === "asc" ? sizeA - sizeB : sizeB - sizeA;
      });
      break;
    case "createdTime":
      sorted.sort((a, b) => {
        const aMs = typeof a.createdTimeMs === "number" && Number.isFinite(a.createdTimeMs) ? a.createdTimeMs : 0;
        const bMs = typeof b.createdTimeMs === "number" && Number.isFinite(b.createdTimeMs) ? b.createdTimeMs : 0;
        return direction === "asc" ? aMs - bMs : bMs - aMs;
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
        return direction === "asc" ? ratioA - ratioB : ratioB - ratioA;
      });
      break;
    case "vmaf":
      {
        const predicted = options?.predictedVmafByPresetId;
        const getDisplayVmaf = (preset: FFmpegPreset): number | null => {
          const measured = getPresetAvgVmaf(preset);
          if (typeof measured === "number" && Number.isFinite(measured)) return measured;
          const v = predicted?.get(preset.id) ?? null;
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        };

        sorted.sort((a, b) => {
          const vmafA = getDisplayVmaf(a);
          const vmafB = getDisplayVmaf(b);
          if (vmafA == null && vmafB == null) return 0;
          if (vmafA == null) return 1;
          if (vmafB == null) return -1;
          return direction === "asc" ? vmafA - vmafB : vmafB - vmafA;
        });
      }
      break;
    case "speed":
      sorted.sort((a, b) => {
        const speedA = getPresetAvgSpeed(a);
        const speedB = getPresetAvgSpeed(b);
        if (speedA == null && speedB == null) return 0;
        if (speedA == null) return 1;
        if (speedB == null) return -1;
        return direction === "asc" ? speedA - speedB : speedB - speedA;
      });
      break;
    case "name":
      sorted.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, "zh-CN");
        return direction === "asc" ? cmp : -cmp;
      });
      break;
  }
  return sorted;
}
