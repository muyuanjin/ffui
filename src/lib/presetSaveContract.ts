import type { FFmpegPreset } from "@/types";

import { normalizeVideoForSave } from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import { normalizePreset } from "@/lib/presetEditorContract/presetDerivation";
import {
  validatePresetEditorState,
  validatePresetForEditor,
  type PresetEditorIssue,
} from "@/lib/presetEditorContract/presetValidator";

export class PresetSaveValidationError extends Error {
  readonly issues: PresetEditorIssue[];

  constructor(issues: PresetEditorIssue[]) {
    super(issues.map((issue) => issue.messageKey).join("; ") || "Preset save validation failed");
    this.name = "PresetSaveValidationError";
    this.issues = issues;
  }
}

export interface PresetSaveContractResult {
  preset: FFmpegPreset;
  warnings: string[];
}

export function validateAndNormalizePresetForSave(preset: FFmpegPreset): PresetSaveContractResult {
  const normalizedResult = normalizePreset(preset);
  const normalized = normalizedResult.preset;
  const savePreset: FFmpegPreset = {
    ...normalized,
    video: normalizeVideoForSave(normalized.video),
    global: normalized.global ?? undefined,
    input: normalized.input ?? undefined,
    mapping: normalized.mapping ?? undefined,
    filters: normalized.filters ?? {},
    subtitles: normalized.subtitles ?? undefined,
    container: normalized.container ?? undefined,
    hardware: normalized.hardware ?? undefined,
    advancedEnabled: normalized.advancedEnabled ?? false,
    ffmpegTemplate: normalized.ffmpegTemplate ?? undefined,
  };

  const summary = validatePresetEditorState({
    global: savePreset.global ?? {},
    input: savePreset.input ?? {},
    mapping: savePreset.mapping ?? {},
    video: savePreset.video,
    audio: savePreset.audio,
    filters: savePreset.filters ?? {},
    subtitles: savePreset.subtitles ?? {},
    container: savePreset.container ?? {},
    hardware: savePreset.hardware ?? {},
    advancedEnabled: { value: Boolean(savePreset.advancedEnabled) },
    ffmpegTemplate: { value: savePreset.ffmpegTemplate ?? "" },
  });
  const errors = summary.issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    throw new PresetSaveValidationError(errors);
  }

  const editorValidation = validatePresetForEditor(savePreset);
  return {
    preset: savePreset,
    warnings: [...normalizedResult.diagnostics.warnings, ...editorValidation.warnings],
  };
}
