import type { FFmpegPreset, BatchCompressConfig } from "@/types";
import { DEFAULT_BATCH_COMPRESS_CONFIG, VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, AUDIO_EXTENSIONS } from "@/constants";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

export function buildBatchCompressConfig(args: {
  presets: FFmpegPreset[];
  initialConfig?: BatchCompressConfig;
  defaultVideoPresetId?: string | null;
}): BatchCompressConfig {
  const { presets, initialConfig, defaultVideoPresetId } = args;
  return {
    ...DEFAULT_BATCH_COMPRESS_CONFIG,
    ...initialConfig,
    outputPolicy: {
      ...(DEFAULT_BATCH_COMPRESS_CONFIG.outputPolicy ?? DEFAULT_OUTPUT_POLICY),
      ...(initialConfig?.outputPolicy ?? {}),
    },
    videoPresetId: initialConfig?.videoPresetId || defaultVideoPresetId || presets[0]?.id || "",
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
