import { DEFAULT_BATCH_COMPRESS_CONFIG } from "@/constants";
import type { AppSettings, BatchCompressConfig } from "@/types";

const cloneBatchCompressDefaults = (): BatchCompressConfig => {
  return {
    ...DEFAULT_BATCH_COMPRESS_CONFIG,
    outputPolicy: DEFAULT_BATCH_COMPRESS_CONFIG.outputPolicy
      ? { ...DEFAULT_BATCH_COMPRESS_CONFIG.outputPolicy }
      : undefined,
    videoFilter: {
      enabled: DEFAULT_BATCH_COMPRESS_CONFIG.videoFilter.enabled,
      extensions: [...DEFAULT_BATCH_COMPRESS_CONFIG.videoFilter.extensions],
    },
    imageFilter: {
      enabled: DEFAULT_BATCH_COMPRESS_CONFIG.imageFilter.enabled,
      extensions: [...DEFAULT_BATCH_COMPRESS_CONFIG.imageFilter.extensions],
    },
    audioFilter: {
      enabled: DEFAULT_BATCH_COMPRESS_CONFIG.audioFilter.enabled,
      extensions: [...DEFAULT_BATCH_COMPRESS_CONFIG.audioFilter.extensions],
    },
  };
};

export const buildWebFallbackAppSettings = (): AppSettings => {
  return {
    tools: {
      ffmpegPath: undefined,
      ffprobePath: undefined,
      avifencPath: undefined,
      autoDownload: false,
      autoUpdate: false,
    },
    batchCompressDefaults: cloneBatchCompressDefaults(),
    previewCapturePercent: 25,
    taskbarProgressMode: "byEstimatedTime",
  } as AppSettings;
};
