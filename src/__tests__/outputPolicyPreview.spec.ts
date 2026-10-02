import { describe, it, expect } from "vitest";
import type { OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { previewOutputPathLocal } from "@/lib/outputPolicyPreview";
import type { FFmpegPreset } from "@/types";
import mediaContract from "../../src-tauri/tests/manual-preset-media-contract.json";

const makePreset = (overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id: "preset-1",
  name: "Preset",
  description: "Preset used by output preview tests",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  ...overrides,
});

describe("previewOutputPathLocal", () => {
  it.each(mediaContract.imageOutputPlanning)(
    "plans the current image output group: $template",
    ({ template, extension }) => {
      const preset = makePreset({ advancedEnabled: true, container: { format: "mp4" }, ffmpegTemplate: template });
      expect(previewOutputPathLocal("C:/素材/input.jpg", DEFAULT_OUTPUT_POLICY, { preset })).toBe(
        `C:/素材/input.compressed.${extension}`,
      );
    },
  );

  it.each([
    ["png", "png"],
    ["mjpeg", "jpg"],
    ["bmp", "bmp"],
    ["tiff", "tiff"],
    ["copy", "webp"],
    ["libwebp", "webp"],
  ])("uses the image2 %s encoder to plan its extension without changing the recipe", (codec, extension) => {
    const preset = makePreset({
      advancedEnabled: true,
      container: { format: "mp4" },
      ffmpegTemplate: `ffmpeg -f image2 -i INPUT -c:v ${codec} -f image2 OUTPUT`,
    });
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "default" },
      filename: { suffix: ".compressed" },
    };
    expect(previewOutputPathLocal("C:/素材/input.webp", policy, { preset })).toBe(
      `C:/素材/input.compressed.${extension}`,
    );
    expect(
      previewOutputPathLocal(
        "C:/素材/input.webp",
        { ...policy, container: { mode: "force", format: "mp3" } },
        { preset },
      ),
    ).toBe("C:/素材/input.compressed.mp3");
    expect(preset.ffmpegTemplate).toBe(`ffmpeg -f image2 -i INPUT -c:v ${codec} -f image2 OUTPUT`);
  });

  it("respects appendOrder for enabled suffix-like options", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "force", format: "mp4" },
      directory: { mode: "sameAsInput" },
      filename: {
        ...DEFAULT_OUTPUT_POLICY.filename,
        suffix: ".compressed",
        appendTimestamp: true,
        appendEncoderQuality: true,
        randomSuffixLen: 6,
        appendOrder: ["timestamp", "suffix", "random", "encoderQuality"],
      },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mkv", policy);
    expect(out).toBe("C:/videos/input-YYYYMMDD-HHmmss.compressed-RANDOM-ENC-QUALITY.mp4");
  });

  it("does not duplicate RANDOM when appendOrder is omitted", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "force", format: "mp4" },
      directory: { mode: "sameAsInput" },
      filename: {
        ...DEFAULT_OUTPUT_POLICY.filename,
        suffix: ".compressed",
        appendTimestamp: true,
        appendEncoderQuality: true,
        randomSuffixLen: 6,
        appendOrder: undefined,
      },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mkv", policy);
    expect(out).toBe("C:/videos/input.compressed-YYYYMMDD-HHmmss-ENC-QUALITY-RANDOM.mp4");
  });

  it("normalizes fixed directories into a stable preview path", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "keepInput" },
      directory: { mode: "fixed", directory: "D:\\Outputs\\" },
      filename: { suffix: ".compressed", appendTimestamp: false, appendEncoderQuality: false },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:\\videos\\input.mp4", policy);
    expect(out).toBe("D:/Outputs/input.compressed.mp4");
  });

  it("uses the structured preset container when container policy is default", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "default" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mp4", policy, {
      preset: makePreset({ container: { format: "matroska" } }),
    });

    expect(out).toBe("C:/videos/input.compressed.mkv");
  });

  it("falls back to the input extension for unknown structured preset containers", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "default" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mov", policy, {
      preset: makePreset({ container: { format: "ipod" } }),
    });

    expect(out).toBe("C:/videos/input.compressed.mov");
  });

  it.each(["asf", "rm", "mpegts", "hls", "dash"])(
    "preserves forced backend container alias %s in the preview extension",
    (format) => {
      const policy: OutputPolicy = {
        ...DEFAULT_OUTPUT_POLICY,
        container: { mode: "force", format },
        directory: { mode: "sameAsInput" },
        filename: { suffix: ".compressed" },
        preserveFileTimes: false,
      };

      const out = previewOutputPathLocal("C:/videos/input.mp4", policy);
      expect(out).toBe(`C:/videos/input.compressed.${format}`);
    },
  );

  it("uses an advanced template output muxer when container policy is default", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "default" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mp4", policy, {
      preset: makePreset({
        advancedEnabled: true,
        ffmpegTemplate: 'ffmpeg -hide_banner -i INPUT -c:v libvpx-vp9 -f "webm" OUTPUT',
      }),
    });

    expect(out).toBe("C:/videos/input.compressed.webm");
  });

  it("falls back to the input extension for unknown advanced template muxers", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "default" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mp4", policy, {
      preset: makePreset({
        advancedEnabled: true,
        ffmpegTemplate: "ffmpeg -i INPUT -c copy -f segment OUTPUT",
      }),
    });

    expect(out).toBe("C:/videos/input.compressed.mp4");
  });
});
