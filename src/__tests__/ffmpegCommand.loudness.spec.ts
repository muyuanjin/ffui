import { describe, it, expect } from "vitest";
import { getFfmpegCommandPreview } from "@/lib/ffmpegCommand";
import type { VideoConfig, AudioConfig, FilterConfig } from "@/types";

describe("ffmpeg command loudness defaults", () => {
  it("injects EBU/国际 loudnorm filter when using EBU loudness profile", () => {
    const video: VideoConfig = {
      encoder: "libx264",
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
    };
    const audio: AudioConfig = {
      codec: "aac",
      bitrate: 320,
      loudnessProfile: "ebuR128",
    };
    const filters: FilterConfig = {};

    const cmd = getFfmpegCommandPreview({
      video,
      audio,
      filters,
      advancedEnabled: false,
      ffmpegTemplate: "",
    });

    expect(cmd).toContain("-c:a aac");
    expect(cmd).toContain("-b:a 320k");
    expect(cmd).toContain("loudnorm=");
    // 默认 EBU/国际响度参数：I≈-23 LUFS, LRA≈7 LU, TP≈-1 dBTP。
    expect(cmd).toContain("I=-23");
    expect(cmd).toContain("LRA=7");
    expect(cmd).toContain("TP=-1");
  });
});
