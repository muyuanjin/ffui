import { DEFAULT_SMART_SCAN_CONFIG } from "@/constants";
import type { SmartScanConfig } from "@/types";

/** 构造带默认值的 SmartScan 配置，避免各处遗漏必填字段。 */
export function buildSmartScanDefaults(overrides: Partial<SmartScanConfig> = {}): SmartScanConfig {
  const videoFilter = overrides.videoFilter ?? DEFAULT_SMART_SCAN_CONFIG.videoFilter;
  const imageFilter = overrides.imageFilter ?? DEFAULT_SMART_SCAN_CONFIG.imageFilter;
  const audioFilter = overrides.audioFilter ?? DEFAULT_SMART_SCAN_CONFIG.audioFilter;
  const outputPolicy = overrides.outputPolicy ?? DEFAULT_SMART_SCAN_CONFIG.outputPolicy;

  return {
    ...DEFAULT_SMART_SCAN_CONFIG,
    ...overrides,
    outputPolicy: outputPolicy ? { ...outputPolicy } : outputPolicy,
    videoFilter: {
      enabled: videoFilter.enabled ?? DEFAULT_SMART_SCAN_CONFIG.videoFilter.enabled,
      extensions: [...(videoFilter.extensions ?? DEFAULT_SMART_SCAN_CONFIG.videoFilter.extensions)],
    },
    imageFilter: {
      enabled: imageFilter.enabled ?? DEFAULT_SMART_SCAN_CONFIG.imageFilter.enabled,
      extensions: [...(imageFilter.extensions ?? DEFAULT_SMART_SCAN_CONFIG.imageFilter.extensions)],
    },
    audioFilter: {
      enabled: audioFilter.enabled ?? DEFAULT_SMART_SCAN_CONFIG.audioFilter.enabled,
      extensions: [...(audioFilter.extensions ?? DEFAULT_SMART_SCAN_CONFIG.audioFilter.extensions)],
    },
  };
}
