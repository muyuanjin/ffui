import { describe, it, expect } from "vitest";

import type { FFmpegPreset } from "@/types";
import { sortPresets } from "@/lib/presetSorter";

const makePreset = (id: string, name: string, totalInputSizeMB: number): FFmpegPreset => ({
  id,
  name,
  description: "",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  } as any,
  audio: {
    codec: "copy",
  } as any,
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  global: undefined,
  input: undefined,
  mapping: undefined,
  subtitles: undefined,
  container: undefined,
  hardware: undefined,
  advancedEnabled: undefined,
  ffmpegTemplate: undefined,
  isSmartPreset: undefined,
});

describe("sortPresets", () => {
  it("sorts presets by input size descending (missing stats last)", () => {
    const small = makePreset("preset-small", "Small", 10);
    const large = makePreset("preset-large", "Large", 250);
    const missing = makePreset("preset-missing", "Missing", 0);

    const sorted = sortPresets([small, missing, large], "inputSize");
    expect(sorted.map((p) => p.id)).toEqual(["preset-large", "preset-small", "preset-missing"]);
  });
});
