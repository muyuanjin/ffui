import { describe, it, expect } from "vitest";
import type { FFmpegPreset } from "@/types";
import { applyPresetStatsDelta } from "./presetStats";

const makePreset = (): FFmpegPreset => ({
  id: "preset-1",
  name: "Preset 1",
  description: "",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 7,
    totalInputSizeMB: 100,
    totalOutputSizeMB: 50,
    totalTimeSeconds: 10,
    totalFrames: 300,
    vmafCount: 2,
    vmafSum: 189.234,
    vmafMin: 94.1,
    vmafMax: 95.134,
  },
});

describe("applyPresetStatsDelta", () => {
  it("accumulates size/time/frames while preserving VMAF aggregation fields", () => {
    const before = makePreset();
    const out = applyPresetStatsDelta([before], "preset-1", 12.5, 3.25, 2, 60);
    expect(out).toHaveLength(1);
    const after = out[0]!;

    expect(after.stats.usageCount).toBe(8);
    expect(after.stats.totalInputSizeMB).toBeCloseTo(112.5, 12);
    expect(after.stats.totalOutputSizeMB).toBeCloseTo(53.25, 12);
    expect(after.stats.totalTimeSeconds).toBeCloseTo(12, 12);
    expect(after.stats.totalFrames).toBeCloseTo(360, 12);

    expect(after.stats.vmafCount).toBe(2);
    expect(after.stats.vmafSum).toBeCloseTo(189.234, 12);
    expect(after.stats.vmafMin).toBeCloseTo(94.1, 12);
    expect(after.stats.vmafMax).toBeCloseTo(95.134, 12);
  });
});
