import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveVideoEditorModel, normalizePreset } from "./presetDerivation";

const here = dirname(fileURLToPath(import.meta.url));
const smartPresetsPath = resolve(here, "../../../src-tauri/assets/smart-presets.json");

const loadSmartPresets = (): any[] => {
  const raw = readFileSync(smartPresetsPath, "utf8");
  const parsed = JSON.parse(raw) as any;
  return Array.isArray(parsed?.presets) ? parsed.presets : [];
};

describe("preset editor contract gate (smart-presets corpus)", () => {
  it("keeps required selects non-empty and current values representable (invariants A+B)", () => {
    const presets = loadSmartPresets();
    expect(presets.length).toBeGreaterThan(0);

    for (const preset of presets) {
      const normalized = normalizePreset(preset as any);
      const model = deriveVideoEditorModel(normalized.preset as any);

      const encoder = String((normalized.preset as any).video?.encoder ?? "");
      const rateControl = String((normalized.preset as any).video?.rateControl ?? "");
      const presetValue = String((normalized.preset as any).video?.preset ?? "");

      expect(model.encoderOptions.length).toBeGreaterThan(0);
      expect(model.encoderOptions.some((o) => String(o.value) === encoder)).toBe(true);

      expect(model.rateControlOptions.length).toBeGreaterThan(0);
      expect(model.rateControlOptions.some((o) => String(o.value) === rateControl)).toBe(true);

      if (encoder !== "copy") {
        expect(model.presetOptions.length).toBeGreaterThan(0);
        expect(model.presetOptions.some((o) => String(o.value) === presetValue)).toBe(true);
      }

      // Corpus presets should not rely on unknown synthetic options.
      expect(model.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(false);
    }
  });

  it("keeps option sets deterministic and bounded for common encoders (invariant C)", () => {
    const presets = loadSmartPresets();

    const NVENC_PRESETS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const X264_PRESETS = [
      "ultrafast",
      "superfast",
      "veryfast",
      "faster",
      "fast",
      "medium",
      "slow",
      "slower",
      "veryslow",
    ];
    const SVT_AV1_PRESETS = ["13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"];

    for (const preset of presets) {
      const normalized = normalizePreset(preset as any);
      const model = deriveVideoEditorModel(normalized.preset as any);
      const encoder = String((normalized.preset as any).video?.encoder ?? "");

      const presetValues = model.presetOptions.map((o) => String(o.value));

      if (encoder.includes("nvenc")) {
        expect(presetValues).toEqual(NVENC_PRESETS);
      } else if (encoder === "libx264") {
        expect(presetValues).toEqual(X264_PRESETS);
      } else if (encoder === "libsvtav1") {
        expect(presetValues).toEqual(SVT_AV1_PRESETS);
      }
    }
  });
});
