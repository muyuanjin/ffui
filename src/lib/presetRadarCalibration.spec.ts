import { describe, expect, it } from "vitest";

import type { FFmpegPreset } from "@/types";
import { computeMeasuredRadarOverrides } from "@/lib/presetRadarCalibration";

const presetWithStats = (id: string, stats: FFmpegPreset["stats"]): FFmpegPreset => ({
  id,
  name: id,
  description: "",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats,
});

describe("computeMeasuredRadarOverrides", () => {
  it("maps speed percentile onto 1..5", () => {
    const slow = presetWithStats("slow", {
      usageCount: 10,
      totalInputSizeMB: 100,
      totalOutputSizeMB: 50,
      totalTimeSeconds: 100,
    }); // 1 MB/s
    const mid = presetWithStats("mid", {
      usageCount: 10,
      totalInputSizeMB: 200,
      totalOutputSizeMB: 50,
      totalTimeSeconds: 100,
    }); // 2 MB/s
    const fast = presetWithStats("fast", {
      usageCount: 10,
      totalInputSizeMB: 1000,
      totalOutputSizeMB: 50,
      totalTimeSeconds: 100,
    }); // 10 MB/s

    const all = [slow, mid, fast];

    expect(computeMeasuredRadarOverrides(slow, all).speed).toBeCloseTo(1, 6);
    expect(computeMeasuredRadarOverrides(mid, all).speed).toBeCloseTo(3, 6);
    expect(computeMeasuredRadarOverrides(fast, all).speed).toBeCloseTo(5, 6);
  });

  it("maps lower ratios to higher sizeSaving scores", () => {
    const best = presetWithStats("best", {
      usageCount: 10,
      totalInputSizeMB: 100,
      totalOutputSizeMB: 30,
      totalTimeSeconds: 10,
    }); // 30%
    const mid = presetWithStats("mid", {
      usageCount: 10,
      totalInputSizeMB: 100,
      totalOutputSizeMB: 60,
      totalTimeSeconds: 10,
    }); // 60%
    const worst = presetWithStats("worst", {
      usageCount: 10,
      totalInputSizeMB: 100,
      totalOutputSizeMB: 100,
      totalTimeSeconds: 10,
    }); // 100%

    const all = [best, mid, worst];

    expect(computeMeasuredRadarOverrides(best, all).sizeSaving).toBeCloseTo(5, 6);
    expect(computeMeasuredRadarOverrides(mid, all).sizeSaving).toBeCloseTo(3, 6);
    expect(computeMeasuredRadarOverrides(worst, all).sizeSaving).toBeCloseTo(1, 6);
  });

  it("maps usageCount percentile onto popularity and keeps 0 when unused", () => {
    const unused = presetWithStats("unused", {
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    });
    const low = presetWithStats("low", {
      usageCount: 1,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    });
    const high = presetWithStats("high", {
      usageCount: 100,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    });

    const all = [unused, low, high];

    expect(computeMeasuredRadarOverrides(unused, all).popularity).toBe(0);
    expect(computeMeasuredRadarOverrides(low, all).popularity).toBeCloseTo(1, 6);
    expect(computeMeasuredRadarOverrides(high, all).popularity).toBeCloseTo(5, 6);
  });
});
