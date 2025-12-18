// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { FFmpegPreset, PresetSortMode } from "@/types";
import { getPresetAvgRatio, getPresetAvgSpeed, sortPresets } from "./presetSorter";

const makePreset = (overrides: Partial<FFmpegPreset>): FFmpegPreset => ({
  id: overrides.id ?? "preset-id",
  name: overrides.name ?? "Preset",
  description: overrides.description ?? "Desc",
  video: overrides.video ?? {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: overrides.audio ?? {
    codec: "aac",
    bitrate: 128,
  },
  filters: overrides.filters ?? {},
  stats: overrides.stats ?? {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  subtitles: overrides.subtitles,
  container: overrides.container,
  hardware: overrides.hardware,
  advancedEnabled: overrides.advancedEnabled,
  ffmpegTemplate: overrides.ffmpegTemplate,
  isSmartPreset: overrides.isSmartPreset,
});

describe("presetSorter.getPresetAvgRatio", () => {
  it("返回输出体积 / 输入体积 * 100，对应 Smart Scan 的压缩率语义", () => {
    const preset = makePreset({
      stats: {
        usageCount: 3,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 80,
        totalTimeSeconds: 60,
      },
    });

    const ratio = getPresetAvgRatio(preset);
    // 80MB / 100MB = 0.8 => 80%
    expect(ratio).toBeCloseTo(80);
  });

  it("当输出体积大于输入体积时返回大于 100 的比例", () => {
    const preset = makePreset({
      stats: {
        usageCount: 2,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 120,
        totalTimeSeconds: 30,
      },
    });

    const ratio = getPresetAvgRatio(preset);
    // 120MB / 100MB = 1.2 => 120%
    expect(ratio).toBeGreaterThan(100);
    expect(ratio).toBeCloseTo(120);
  });

  it("在缺少或非法统计数据时返回 null", () => {
    expect(
      getPresetAvgRatio(
        makePreset({
          stats: {
            usageCount: 0,
            totalInputSizeMB: 0,
            totalOutputSizeMB: 0,
            totalTimeSeconds: 0,
          },
        }),
      ),
    ).toBeNull();

    expect(
      getPresetAvgRatio(
        makePreset({
          stats: {
            usageCount: 1,
            totalInputSizeMB: 0,
            totalOutputSizeMB: 50,
            totalTimeSeconds: 10,
          },
        }),
      ),
    ).toBeNull();

    expect(
      getPresetAvgRatio(
        makePreset({
          stats: {
            usageCount: 1,
            totalInputSizeMB: 100,
            totalOutputSizeMB: 0,
            totalTimeSeconds: 10,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("presetSorter.getPresetAvgSpeed", () => {
  it("返回平均处理速度（输入体积 / 总耗时）", () => {
    const preset = makePreset({
      stats: {
        usageCount: 1,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 50,
        totalTimeSeconds: 20,
      },
    });

    const speed = getPresetAvgSpeed(preset);
    expect(speed).toBeCloseTo(5); // 100 MB / 20 s = 5 MB/s
  });
});

describe("presetSorter.sortPresets", () => {
  it("按压缩率排序时，压缩率（输出/输入百分比）越小的预设排在前面，没有统计数据的排在最后", () => {
    const strong = makePreset({
      id: "strong",
      name: "Strong",
      stats: {
        usageCount: 2,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 40, // 40%
        totalTimeSeconds: 40,
      },
    });

    const medium = makePreset({
      id: "medium",
      name: "Medium",
      stats: {
        usageCount: 2,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 70, // 70%
        totalTimeSeconds: 30,
      },
    });

    const weak = makePreset({
      id: "weak",
      name: "Weak",
      stats: {
        usageCount: 2,
        totalInputSizeMB: 100,
        totalOutputSizeMB: 90, // 90%
        totalTimeSeconds: 20,
      },
    });

    const noStats = makePreset({
      id: "no-stats",
      name: "NoStats",
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    });

    const sorted = sortPresets([noStats, weak, medium, strong], "ratio" as PresetSortMode);
    const ids = sorted.map((p) => p.id);

    // 40% < 70% < 90%，最后是没有统计数据的预设
    expect(ids).toEqual(["strong", "medium", "weak", "no-stats"]);
  });
});
