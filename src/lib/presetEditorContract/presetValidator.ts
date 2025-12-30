import type { FFmpegPreset } from "@/types";

import { getPresetCommandPreview } from "@/lib/ffmpegCommand";

import { deriveVideoEditorModel, normalizePreset } from "./presetDerivation";

export interface PresetValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalizedPreset: FFmpegPreset;
}

export const validatePresetForEditor = (preset: FFmpegPreset): PresetValidationResult => {
  const normalized = normalizePreset(preset).preset;
  const model = deriveVideoEditorModel(normalized);

  const encoder = String(normalized.video?.encoder ?? "");
  const errors: string[] = [];

  if (model.encoderOptions.length === 0) errors.push("encoder options are empty");
  if (model.rateControlOptions.length === 0) errors.push("rate control options are empty");
  if (encoder !== "copy" && model.presetOptions.length === 0) errors.push("preset options are empty");

  return {
    ok: errors.length === 0,
    errors,
    warnings: model.warnings,
    normalizedPreset: normalized,
  };
};

export const quarantinePresetIfInvalid = (
  preset: FFmpegPreset,
  result?: PresetValidationResult,
): { preset: FFmpegPreset; quarantined: boolean } => {
  const validation = result ?? validatePresetForEditor(preset);
  if (validation.ok) return { preset: validation.normalizedPreset, quarantined: false };

  let template = "";
  try {
    template = getPresetCommandPreview(validation.normalizedPreset);
  } catch {
    template = String(validation.normalizedPreset.ffmpegTemplate ?? "").trim();
  }

  const reason = validation.errors.join("; ");
  const suffix = `[Quarantined preset] ${reason}`;
  const description = String(validation.normalizedPreset.description ?? "").trim();

  return {
    preset: {
      ...validation.normalizedPreset,
      description: description ? `${description}\n\n${suffix}` : suffix,
      advancedEnabled: true,
      ffmpegTemplate: template || validation.normalizedPreset.ffmpegTemplate,
    },
    quarantined: true,
  };
};
