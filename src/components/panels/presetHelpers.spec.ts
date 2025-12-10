import { describe, it, expect } from "vitest";

import type { FFmpegPreset } from "@/types";
import { getSubtitleSummary } from "./presetHelpers";

const t = ((key: string) => key) as (key: string) => string;

const makeBasePreset = (overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id: "preset-1",
  name: "Test Preset",
  description: "Test description",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
    ...(overrides.video ?? {}),
  } as any,
  audio: {
    codec: "copy",
    ...(overrides.audio ?? {}),
  } as any,
  filters: overrides.filters ?? {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
    ...(overrides.stats ?? {}),
  },
  global: overrides.global,
  input: overrides.input,
  mapping: overrides.mapping,
  subtitles: overrides.subtitles,
  container: overrides.container,
  hardware: overrides.hardware,
  advancedEnabled: overrides.advancedEnabled,
  ffmpegTemplate: overrides.ffmpegTemplate,
  isSmartPreset: overrides.isSmartPreset,
});

describe("getSubtitleSummary", () => {
  it("treats missing subtitles as keep", () => {
    const preset = makeBasePreset({ subtitles: undefined });
    const summary = getSubtitleSummary(preset, t);
    expect(summary).toBe("presets.subtitleKeep");
  });

  it("treats subtitles object without strategy as keep (backward compatibility)", () => {
    const preset = makeBasePreset({ subtitles: {} as any });
    const summary = getSubtitleSummary(preset, t);
    expect(summary).toBe("presets.subtitleKeep");
  });

  it("returns drop/burn-in labels for corresponding strategies", () => {
    const dropPreset = makeBasePreset({ subtitles: { strategy: "drop" } });
    const burnInPreset = makeBasePreset({ subtitles: { strategy: "burn_in" } });

    expect(getSubtitleSummary(dropPreset, t)).toBe("presets.subtitleDrop");
    expect(getSubtitleSummary(burnInPreset, t)).toBe("presets.subtitleBurnIn");
  });
});
