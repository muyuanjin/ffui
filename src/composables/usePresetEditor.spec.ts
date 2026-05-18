import { describe, expect, it } from "vitest";
import { usePresetEditor } from "@/composables/usePresetEditor";
import type { FFmpegPreset } from "@/types";

const makePreset = (overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id: "preset-editor-test",
  name: "Preset editor test",
  description: "",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  ...overrides,
});

describe("usePresetEditor", () => {
  it("includes every structured option group when generating an advanced template", () => {
    const editor = usePresetEditor({
      initialPreset: makePreset({
        global: {
          overwriteBehavior: "overwrite",
          logLevel: "error",
          hideBanner: true,
        },
        input: {
          seekMode: "input",
          seekPosition: "00:00:10",
          streamLoop: -1,
          inputTimeOffset: "0.5",
          durationMode: "duration",
          duration: "5",
        },
        mapping: {
          maps: ["0:v:0", "0:a:0"],
        },
        subtitles: {
          strategy: "drop",
        },
        container: {
          format: "mp4",
        },
        hardware: {
          hwaccel: "cuda",
          hwaccelDevice: "cuda:0",
          hwaccelOutputFormat: "cuda",
          bitstreamFilters: ["h264_mp4toannexb"],
        },
      }),
      t: (_key, fallback) => fallback ?? _key,
    });

    editor.handleParseTemplateFromCommand();

    expect(editor.advancedEnabled.value).toBe(true);
    expect(editor.ffmpegTemplate.value).toContain("-y");
    expect(editor.ffmpegTemplate.value).toContain("-ss 00:00:10");
    expect(editor.ffmpegTemplate.value).toContain("-stream_loop -1");
    expect(editor.ffmpegTemplate.value).toContain("-itsoffset 0.5");
    expect(editor.ffmpegTemplate.value).toContain("-map 0:v:0");
    expect(editor.ffmpegTemplate.value).toContain("-map 0:a:0");
    expect(editor.ffmpegTemplate.value).toContain("-sn");
    expect(editor.ffmpegTemplate.value).toContain("-f mp4");
    expect(editor.ffmpegTemplate.value).toContain("-hwaccel cuda");
    expect(editor.ffmpegTemplate.value).toContain("-hwaccel_device cuda:0");
    expect(editor.ffmpegTemplate.value).toContain("-hwaccel_output_format cuda");
    expect(editor.ffmpegTemplate.value).toContain("-bsf h264_mp4toannexb");
  });

  it("blocks structured two-pass conversion to a single advanced template", () => {
    const editor = usePresetEditor({
      initialPreset: makePreset({
        video: {
          encoder: "libx264",
          rateControl: "vbr",
          qualityValue: 23,
          preset: "medium",
          bitrateKbps: 3000,
          pass: 2,
        },
      }),
      t: (key, fallback) =>
        key === "presetEditor.advanced.parseTwoPassUnsupported"
          ? "Two-pass presets must stay in generated mode because they require two ffmpeg runs."
          : (fallback ?? key),
    });

    editor.handleParseTemplateFromCommand();

    expect(editor.advancedEnabled.value).toBe(false);
    expect(editor.ffmpegTemplate.value).toBe("");
    expect(editor.parseHint.value).toContain("Two-pass presets");
    expect(editor.parseHintVariant.value).toBe("warning");
  });

  it("allows template conversion when pass is set without a positive bitrate", () => {
    const editor = usePresetEditor({
      initialPreset: makePreset({
        video: {
          encoder: "libx264",
          rateControl: "vbr",
          qualityValue: 23,
          preset: "medium",
          pass: 2,
        },
      }),
      t: (_key, fallback) => fallback ?? _key,
    });

    editor.handleParseTemplateFromCommand();

    expect(editor.advancedEnabled.value).toBe(true);
    expect(editor.ffmpegTemplate.value).toContain("-c:v libx264");
    expect(editor.ffmpegTemplate.value).not.toContain("-pass ");
    expect(editor.ffmpegTemplate.value).not.toContain("-passlogfile");
    expect(editor.parseHintVariant.value).not.toBe("warning");
  });
});
