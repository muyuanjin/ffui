import { DEFAULT_SMART_SCAN_CONFIG } from "@/constants";
import type { AppSettings, SmartScanConfig } from "@/types";

const cloneSmartScanDefaults = (): SmartScanConfig => {
  return {
    ...DEFAULT_SMART_SCAN_CONFIG,
    outputPolicy: DEFAULT_SMART_SCAN_CONFIG.outputPolicy
      ? { ...DEFAULT_SMART_SCAN_CONFIG.outputPolicy }
      : undefined,
    videoFilter: {
      enabled: DEFAULT_SMART_SCAN_CONFIG.videoFilter.enabled,
      extensions: [...DEFAULT_SMART_SCAN_CONFIG.videoFilter.extensions],
    },
    imageFilter: {
      enabled: DEFAULT_SMART_SCAN_CONFIG.imageFilter.enabled,
      extensions: [...DEFAULT_SMART_SCAN_CONFIG.imageFilter.extensions],
    },
    audioFilter: {
      enabled: DEFAULT_SMART_SCAN_CONFIG.audioFilter.enabled,
      extensions: [...DEFAULT_SMART_SCAN_CONFIG.audioFilter.extensions],
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
    smartScanDefaults: cloneSmartScanDefaults(),
    previewCapturePercent: 25,
    taskbarProgressMode: "byEstimatedTime",
  } as AppSettings;
};

