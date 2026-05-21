import { describe, expect, it } from "vitest";
import { buildBatchCompressDefaults } from "@/__tests__/helpers/batchCompressDefaults";
import { canStartBatchCompress, normalizeBatchCompressConfig } from "@/lib/batchCompressValidation";
import type { FFmpegPreset } from "@/types";

const presets: FFmpegPreset[] = [
  {
    id: "p1",
    name: "Preset",
    description: "Preset",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
    audio: { codec: "copy" },
    filters: {},
    stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  },
];

describe("batchCompressValidation", () => {
  it("normalizes numeric fields before submit", () => {
    const config = buildBatchCompressDefaults({
      minVideoSizeMB: -1,
      minImageSizeKB: Number.NaN,
      minAudioSizeKB: 4.8,
      minSavingAbsoluteMB: -3,
    });

    const normalized = normalizeBatchCompressConfig(config);

    expect(normalized.minVideoSizeMB).toBe(0);
    expect(normalized.minImageSizeKB).toBe(0);
    expect(normalized.minAudioSizeKB).toBe(4);
    expect(normalized.minSavingAbsoluteMB).toBe(0);
  });

  it("requires a valid preset when video compression is enabled", () => {
    expect(
      canStartBatchCompress(
        buildBatchCompressDefaults({
          rootPath: "C:/videos",
          videoPresetId: "missing",
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
        }),
        presets,
      ),
    ).toBe(false);
  });

  it("does not require a video preset when no video extensions are selected", () => {
    expect(
      canStartBatchCompress(
        buildBatchCompressDefaults({
          rootPath: "C:/media",
          videoPresetId: "missing",
          videoFilter: { enabled: true, extensions: [] },
          imageFilter: { enabled: true, extensions: ["jpg"] },
          audioFilter: { enabled: false, extensions: [] },
        }),
        presets,
      ),
    ).toBe(true);
  });

  it("rejects stale audio preset ids when audio compression is enabled", () => {
    expect(
      canStartBatchCompress(
        buildBatchCompressDefaults({
          rootPath: "C:/media",
          videoFilter: { enabled: false, extensions: [] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: true, extensions: ["mp3"] },
          audioPresetId: "missing-audio-preset",
        }),
        presets,
      ),
    ).toBe(false);
  });

  it("allows default audio compression with an empty audio preset id", () => {
    expect(
      canStartBatchCompress(
        buildBatchCompressDefaults({
          rootPath: "C:/media",
          videoFilter: { enabled: false, extensions: [] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: true, extensions: ["mp3"] },
          audioPresetId: "",
        }),
        presets,
      ),
    ).toBe(true);
  });

  it("clears stale audio preset ids during normalization when presets are provided", () => {
    const normalized = normalizeBatchCompressConfig(
      buildBatchCompressDefaults({ audioPresetId: "missing-audio-preset" }),
      presets,
    );

    expect(normalized.audioPresetId).toBe("");
  });
});
