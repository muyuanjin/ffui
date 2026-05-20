import type { BatchCompressConfig, FFmpegPreset } from "@/types";

const normalizeNonNegativeInteger = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
};

const normalizeNonNegativeNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

export function normalizeBatchCompressConfig(value: BatchCompressConfig): BatchCompressConfig {
  return {
    ...value,
    minVideoSizeMB: normalizeNonNegativeInteger(value.minVideoSizeMB),
    minImageSizeKB: normalizeNonNegativeInteger(value.minImageSizeKB),
    minAudioSizeKB: normalizeNonNegativeInteger(value.minAudioSizeKB),
    minSavingRatio: normalizeNonNegativeNumber(value.minSavingRatio),
    minSavingAbsoluteMB: normalizeNonNegativeNumber(value.minSavingAbsoluteMB),
    videoFilter: { ...value.videoFilter, extensions: [...value.videoFilter.extensions] },
    imageFilter: { ...value.imageFilter, extensions: [...value.imageFilter.extensions] },
    audioFilter: { ...value.audioFilter, extensions: [...value.audioFilter.extensions] },
    outputPolicy: value.outputPolicy ? { ...value.outputPolicy } : value.outputPolicy,
  };
}

export function canStartBatchCompress(config: BatchCompressConfig, presets: FFmpegPreset[]): boolean {
  const hasPath = !!config.rootPath?.trim();
  const filters = [config.videoFilter, config.imageFilter, config.audioFilter];
  const hasAnyFilter = filters.some((filter) => filter.enabled && filter.extensions.length > 0);
  const hasVideoCandidates = config.videoFilter.enabled && config.videoFilter.extensions.length > 0;
  const hasValidVideoPreset = !hasVideoCandidates || presets.some((preset) => preset.id === config.videoPresetId);
  return hasPath && hasAnyFilter && hasValidVideoPreset;
}
