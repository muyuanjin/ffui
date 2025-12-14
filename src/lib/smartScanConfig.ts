import type { FFmpegPreset, SmartScanConfig } from "@/types";
import {
  DEFAULT_SMART_SCAN_CONFIG,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from "@/constants";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

export function buildSmartScanConfig(args: {
  presets: FFmpegPreset[];
  initialConfig?: SmartScanConfig;
  defaultVideoPresetId?: string | null;
}): SmartScanConfig {
  const { presets, initialConfig, defaultVideoPresetId } = args;
  return {
    ...DEFAULT_SMART_SCAN_CONFIG,
    ...initialConfig,
    outputPolicy: {
      ...(DEFAULT_SMART_SCAN_CONFIG.outputPolicy ?? DEFAULT_OUTPUT_POLICY),
      ...(initialConfig?.outputPolicy ?? {}),
    },
    videoPresetId:
      initialConfig?.videoPresetId ||
      defaultVideoPresetId ||
      presets[0]?.id ||
      "",
    videoFilter: {
      enabled: initialConfig?.videoFilter?.enabled ?? true,
      extensions: [...(initialConfig?.videoFilter?.extensions ?? VIDEO_EXTENSIONS)],
    },
    imageFilter: {
      enabled: initialConfig?.imageFilter?.enabled ?? true,
      extensions: [...(initialConfig?.imageFilter?.extensions ?? IMAGE_EXTENSIONS)],
    },
    audioFilter: {
      enabled: initialConfig?.audioFilter?.enabled ?? false,
      extensions: [...(initialConfig?.audioFilter?.extensions ?? AUDIO_EXTENSIONS)],
    },
  };
}

