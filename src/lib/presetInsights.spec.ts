import { describe, it, expect } from "vitest";
import type { FFmpegPreset } from "@/types";
import { computePresetInsights, computePresetRadarHeuristic } from "./presetInsights";

const baseStats = {
  usageCount: 0,
  totalInputSizeMB: 0,
  totalOutputSizeMB: 0,
  totalTimeSeconds: 0,
};

const makePreset = (partial: Partial<FFmpegPreset>): FFmpegPreset => {
  return {
    id: "test",
    name: "Test Preset",
    description: "",
    video: {
      encoder: "libx264",
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
      ...partial.video,
    } as FFmpegPreset["video"],
    audio: {
      codec: "copy",
      ...partial.audio,
    } as FFmpegPreset["audio"],
    filters: partial.filters ?? {},
    stats: { ...baseStats, ...(partial.stats ?? {}) },
    global: partial.global,
    input: partial.input,
    mapping: partial.mapping,
    subtitles: partial.subtitles,
    container: partial.container,
    hardware: partial.hardware,
    advancedEnabled: partial.advancedEnabled,
    ffmpegTemplate: partial.ffmpegTemplate,
    isSmartPreset: partial.isSmartPreset,
  };
};

describe("computePresetInsights", () => {
  it("does not saturate speed at 5 without stats (estimate only)", () => {
    const nvencFast = makePreset({
      id: "nvenc-p1-no-stats",
      video: { encoder: "av1_nvenc", rateControl: "cq", qualityValue: 28, preset: "p1" },
    });
    const x264Ultra = makePreset({
      id: "x264-ultrafast-no-stats",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "ultrafast" },
    });

    expect(computePresetInsights(nvencFast).radar.speed).toBeLessThanOrEqual(4.5);
    expect(computePresetInsights(x264Ultra).radar.speed).toBeLessThanOrEqual(4.5);
  });

  it("marks AV1 NVENC constqp18 as lossless, not beginner-friendly, and likely to increase size", () => {
    const preset = makePreset({
      id: "smart-av1-nvenc-hq-constqp18",
      name: "AV1 NVENC HQ ConstQP18",
      description: "RTX40+/Ada 视觉无损：AV1 NVENC constqp18 p7 HQ，10-bit。",
      video: {
        encoder: "av1_nvenc",
        rateControl: "constqp",
        qualityValue: 18,
        preset: "p7",
        pixFmt: "p010le",
      },
    });

    const insights = computePresetInsights(preset);

    expect(insights.scenario).toBe("lossless");
    expect(insights.mayIncreaseSize).toBe(true);
    expect(insights.isBeginnerFriendly).toBe(false);
    expect(insights.radar.quality).toBeGreaterThanOrEqual(4.5);
    // 视觉无损 ConstQP18 在没有统计数据时，体积轴不应被评为“很省空间”，避免误导用户
    expect(insights.radar.sizeSaving).toBeLessThanOrEqual(2);
  });

  it("treats HEVC NVENC CQ26 as a balanced, beginner-friendly daily/share preset", () => {
    const preset = makePreset({
      id: "smart-hevc-balanced",
      name: "H.265 Balanced NVENC",
      description: "NVENC 日常平衡：HEVC CQ26 p7 10-bit，质量/体积折中。",
      video: {
        encoder: "hevc_nvenc",
        rateControl: "cq",
        qualityValue: 26,
        preset: "p7",
        pixFmt: "yuv420p10le",
      },
    });

    const insights = computePresetInsights(preset);

    expect(["daily", "share"]).toContain(insights.scenario);
    expect(insights.isBeginnerFriendly).toBe(true);
    // 体积评分应明显优于 constqp18 档
    expect(insights.radar.sizeSaving).toBeGreaterThan(2);
  });

  it("uses real stats to drive sizeSaving and speed when available", () => {
    const presetWithStats = makePreset({
      id: "with-stats",
      video: {
        encoder: "hevc_nvenc",
        rateControl: "cq",
        qualityValue: 28,
        preset: "p7",
      },
      stats: {
        usageCount: 10,
        totalInputSizeMB: 1000,
        totalOutputSizeMB: 500, // 50% 体积
        totalTimeSeconds: 20, // 50 MB/s
      },
    });

    const insights = computePresetInsights(presetWithStats);

    expect(insights.hasStats).toBe(true);
    // 50% 体积应被视为压缩能力很强
    expect(insights.radar.sizeSaving).toBeGreaterThanOrEqual(4);
    // 50 MB/s 也应被视为高速
    expect(insights.radar.speed).toBeGreaterThanOrEqual(4);
    // 使用次数大于零时 popularity 不应为 0
    expect(insights.radar.popularity).toBeGreaterThan(0);
  });

  it("classifies h264_nvenc encoder as nvenc-h264 family", () => {
    const preset = makePreset({
      id: "smart-h264-nvenc-hq",
      name: "H.264 HQ NVENC",
      description: "NVENC H.264 兼容性优先：cq29 p7。",
      video: {
        encoder: "h264_nvenc",
        rateControl: "cq",
        qualityValue: 29,
        preset: "p7",
      },
    });

    const insights = computePresetInsights(preset);

    expect(insights.encoderFamily).toBe("nvenc-h264");
  });

  it("computes heuristic radar without consuming job stats", () => {
    const preset = makePreset({
      id: "nvenc-with-slow-stats",
      video: { encoder: "av1_nvenc", rateControl: "cq", qualityValue: 36, preset: "p7" },
      stats: {
        usageCount: 3,
        totalInputSizeMB: 300,
        totalOutputSizeMB: 120,
        totalTimeSeconds: 200, // 1.5 MB/s (slow in practice)
      },
    });

    const insights = computePresetInsights(preset);
    expect(insights.hasStats).toBe(true);

    const heuristic = computePresetRadarHeuristic(preset);
    // The heuristic speed estimate must not be derived from preset.stats.
    expect(heuristic.speed).toBeGreaterThan(insights.radar.speed);
    // The heuristic function must not read preset.stats to "learn" from it.
    expect(heuristic.speed).not.toBeCloseTo(insights.radar.speed, 6);
  });

  it("marks experimental AMF AV1 presets as experimental scenario", () => {
    const preset = makePreset({
      id: "smart-av1-amf-balanced",
      name: "AV1 Balanced (AMF)",
      description: "AMD 7000+：AV1 AMF qp34 preset balanced，体积优先（实验性）。",
      video: {
        encoder: "av1_amf",
        rateControl: "cq",
        qualityValue: 34,
        preset: "balanced",
      },
    });

    const insights = computePresetInsights(preset);

    expect(insights.scenario).toBe("experimental");
    expect(insights.isBeginnerFriendly).toBe(false);
  });
});
