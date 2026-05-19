import { describe, expect, it } from "vitest";
import type { FFmpegPreset } from "@/types";

import { PresetSaveValidationError, validateAndNormalizePresetForSave } from "./presetSaveContract";

const makePreset = (overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id: "save-contract",
  name: "Save Contract",
  description: "contract test",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
    ...(overrides.video ?? {}),
  },
  audio: { codec: "copy", ...(overrides.audio ?? {}) },
  filters: { ...(overrides.filters ?? {}) },
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
    ...(overrides.stats ?? {}),
  },
  ...overrides,
});

const expectSaveError = (preset: FFmpegPreset, pattern: RegExp) => {
  expect(() => validateAndNormalizePresetForSave(preset)).toThrow(PresetSaveValidationError);
  try {
    validateAndNormalizePresetForSave(preset);
  } catch (error) {
    expect(error).toBeInstanceOf(PresetSaveValidationError);
    expect((error as Error).message).toMatch(pattern);
  }
};

describe("preset save contract", () => {
  it("accepts decimal fps and preserves unknown encoder/rateControl strings", () => {
    const preset = makePreset({
      video: {
        encoder: "future_encoder",
        rateControl: "future_rc",
        qualityValue: 23,
        preset: "medium",
      },
      filters: { fps: 29.97 },
    });

    const result = validateAndNormalizePresetForSave(preset);

    expect(result.preset.filters.fps).toBe(29.97);
    expect(result.preset.video.encoder).toBe("future_encoder");
    expect(result.preset.video.rateControl).toBe("future_rc");
    expect(result.warnings.join("\n")).toContain("Unknown encoder");
    expect(result.warnings.join("\n")).toContain("Unknown rate control");
  });

  it("rejects invalid custom template placeholders", () => {
    expectSaveError(
      makePreset({
        advancedEnabled: true,
        ffmpegTemplate: "ffmpeg -i INPUT -i INPUT -c:v libx264 OUTPUT",
      }),
      /invalidTemplatePlaceholders/,
    );
  });

  it("rejects out-of-range quality values", () => {
    expectSaveError(
      makePreset({ video: { encoder: "libx264", rateControl: "crf", qualityValue: 99, preset: "x" } }),
      /qualityOutOfRange/,
    );
  });

  it("rejects maxrate below target bitrate", () => {
    expectSaveError(
      makePreset({
        video: {
          encoder: "libx264",
          rateControl: "vbr",
          qualityValue: 23,
          preset: "medium",
          bitrateKbps: 4000,
          maxBitrateKbps: 3000,
        },
      }),
      /maxrateBelowBitrate/,
    );
  });

  it("rejects fractional integer-only video fields", () => {
    expectSaveError(
      makePreset({
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium", gopSize: 12.5 },
      }),
      /integerFieldRequired/,
    );
  });
});
