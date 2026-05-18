import type { VideoConfig } from "@/types";

export const isStructuredTwoPassVideo = (video: VideoConfig): boolean =>
  video.encoder !== "copy" &&
  (video.pass === 1 || video.pass === 2) &&
  (video.rateControl === "cbr" || video.rateControl === "vbr") &&
  typeof video.bitrateKbps === "number" &&
  video.bitrateKbps > 0;
