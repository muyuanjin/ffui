import { invokeCommand } from "./invokeCommand";

export type FallbackFrameQuality = "low" | "high";

export const extractFallbackPreviewFrame = async (args: {
  sourcePath: string;
  positionPercent?: number;
  positionSeconds?: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invokeCommand<string>("extract_fallback_preview_frame", {
    sourcePath: args.sourcePath,
    positionPercent: args.positionPercent,
    positionSeconds: args.positionSeconds,
    durationSeconds: args.durationSeconds,
    quality: args.quality,
  });
};

export const cleanupFallbackPreviewFramesAsync = async (): Promise<boolean> => {
  return invokeCommand<boolean>("cleanup_fallback_preview_frames_async");
};
