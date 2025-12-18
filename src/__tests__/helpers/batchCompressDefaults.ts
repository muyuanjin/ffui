import { DEFAULT_BATCH_COMPRESS_CONFIG } from "@/constants";
import type { BatchCompressConfig } from "@/types";

/** 构造带默认值的 BatchCompress 配置，避免各处遗漏必填字段。 */
export function buildBatchCompressDefaults(overrides: Partial<BatchCompressConfig> = {}): BatchCompressConfig {
  const videoFilter = overrides.videoFilter ?? DEFAULT_BATCH_COMPRESS_CONFIG.videoFilter;
  const imageFilter = overrides.imageFilter ?? DEFAULT_BATCH_COMPRESS_CONFIG.imageFilter;
  const audioFilter = overrides.audioFilter ?? DEFAULT_BATCH_COMPRESS_CONFIG.audioFilter;
  const outputPolicy = overrides.outputPolicy ?? DEFAULT_BATCH_COMPRESS_CONFIG.outputPolicy;

  return {
    ...DEFAULT_BATCH_COMPRESS_CONFIG,
    ...overrides,
    outputPolicy: outputPolicy ? { ...outputPolicy } : outputPolicy,
    videoFilter: {
      enabled: videoFilter.enabled ?? DEFAULT_BATCH_COMPRESS_CONFIG.videoFilter.enabled,
      extensions: [...(videoFilter.extensions ?? DEFAULT_BATCH_COMPRESS_CONFIG.videoFilter.extensions)],
    },
    imageFilter: {
      enabled: imageFilter.enabled ?? DEFAULT_BATCH_COMPRESS_CONFIG.imageFilter.enabled,
      extensions: [...(imageFilter.extensions ?? DEFAULT_BATCH_COMPRESS_CONFIG.imageFilter.extensions)],
    },
    audioFilter: {
      enabled: audioFilter.enabled ?? DEFAULT_BATCH_COMPRESS_CONFIG.audioFilter.enabled,
      extensions: [...(audioFilter.extensions ?? DEFAULT_BATCH_COMPRESS_CONFIG.audioFilter.extensions)],
    },
  };
}
