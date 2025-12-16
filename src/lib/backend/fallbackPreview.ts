import { invoke } from "@tauri-apps/api/core";

export type FallbackFrameQuality = "low" | "high";

export const extractFallbackPreviewFrame = async (args: {
  sourcePath: string;
  positionPercent?: number;
  positionSeconds?: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invoke<string>("extract_fallback_preview_frame", {
    sourcePath: args.sourcePath,
    source_path: args.sourcePath,
    positionPercent: args.positionPercent,
    position_percent: args.positionPercent,
    positionSeconds: args.positionSeconds,
    position_seconds: args.positionSeconds,
    durationSeconds: args.durationSeconds,
    duration_seconds: args.durationSeconds,
    quality: args.quality,
  });
};

export const cleanupFallbackPreviewFramesAsync = async (): Promise<boolean> => {
  return invoke<boolean>("cleanup_fallback_preview_frames_async");
};
