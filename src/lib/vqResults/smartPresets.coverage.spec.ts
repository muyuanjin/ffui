import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FFmpegPreset } from "@/types";
import { predictFromVqResults } from "./predict";
import type { VqResultsSnapshot } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const smartPresetsPath = resolve(here, "../../../src-tauri/assets/smart-presets.json");

const loadSmartPresets = (): FFmpegPreset[] => {
  const raw = readFileSync(smartPresetsPath, "utf8");
  const parsed = JSON.parse(raw) as { presets?: unknown[] };
  if (!Array.isArray(parsed?.presets)) return [];
  return parsed.presets as FFmpegPreset[];
};

const mkVmaf = (key: string) => ({
  set: 1 as const,
  metric: "vmaf" as const,
  key,
  label: key,
  points: [
    { x: 1000, y: 90 },
    { x: 2000, y: 95 },
  ],
});

describe("vq_results prediction coverage (smart-presets corpus)", () => {
  it("keeps all built-in video presets predictable when benchmark datasets exist", () => {
    const presets = loadSmartPresets().filter((p) => String(p.video?.encoder ?? "") !== "copy");
    expect(presets.length).toBeGreaterThan(0);

    const datasetKeys = [
      // x264 / x265 / SVT-AV1
      "x264_medium_crf",
      "x265_medium_crf",
      "x265_medium_10bit_crf",
      "x265_veryslow_crf",
      "svtav1_8bit_preset_7",
      "svtav1_10bit_preset_5",
      "svtav1_10bit_preset_7",

      // NVENC (NVIDIA)
      "rtx4080_NVEncC_HEVC_quality",
      "rtx4080_NVEncC_HEVC_normal",
      "rtx4080_NVEncC_HEVC_10bit_quality",
      "rtx4080_NVEncC_AV1_quality",
      "rtx4080_NVEncC_AV1_normal",
      "rtx4080_NVEncC_AV1_10bit_quality",
      "rtx4080_NVEncC_AV1_10bit_normal",
      "rtx4080_NVEncC_H_264_quality",
      "rtx4080_NVEncC_H_264_normal",

      // QSV (Intel)
      "u7_258v_QSVEncC_HEVC_quality",
      "u7_258v_QSVEncC_AV1_quality",
      "u7_258v_QSVEncC_AV1_10bit_quality",

      // AMF (AMD)
      "rx7900xt_VCEEncC_HEVC_normal",
      "rx7900xt_VCEEncC_AV1_normal",
    ];

    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: datasetKeys.map(mkVmaf),
    };

    const failures: { id: string; encoder: string; preset: string | undefined }[] = [];
    for (const preset of presets) {
      const predicted = predictFromVqResults(snapshot, preset);
      if (!predicted) {
        failures.push({
          id: String(preset.id ?? preset.name ?? "unknown"),
          encoder: String(preset.video?.encoder ?? ""),
          preset: preset.video?.preset,
        });
      }
    }

    expect(failures).toEqual([]);
  });
});
