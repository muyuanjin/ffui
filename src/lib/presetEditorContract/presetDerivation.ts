import type { EncoderType, FFmpegPreset, RateControlMode, VideoConfig } from "@/types";

import { getEncoderCapability, getEncoderOptions } from "./encoderCapabilityRegistry";

export interface PresetDiagnostics {
  warnings: string[];
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  unknown?: boolean;
}

export interface VideoEditorModel {
  encoderOptions: SelectOption<EncoderType>[];
  rateControlOptions: SelectOption<RateControlMode>[];
  presetOptions: SelectOption<string>[];
  qualityRange: { min: number; max: number };
  warnings: string[];
}

const toUnknownLabel = (value: string) => `Unknown (${value})`;

const ensureOptionsIncludeValue = <T extends string>(
  known: readonly T[],
  current: T,
): { options: SelectOption<T>[]; isUnknown: boolean } => {
  const list = known.map((value) => ({ value, label: value }));
  if (!current || known.includes(current)) {
    return { options: list, isUnknown: false };
  }
  return { options: [{ value: current, label: toUnknownLabel(current), unknown: true }, ...list], isUnknown: true };
};

export const normalizePreset = (
  preset: FFmpegPreset,
): {
  preset: FFmpegPreset;
  diagnostics: PresetDiagnostics;
} => {
  const warnings: string[] = [];
  const normalizedVideo: VideoConfig = { ...(preset.video as VideoConfig) };

  if ((normalizedVideo as any).pass === 1) {
    normalizedVideo.pass = 2;
    warnings.push("video.pass=1 is not supported; normalized to 2");
  }

  const rawEncoder = String((normalizedVideo as any).encoder ?? "").trim();
  if (!rawEncoder) {
    (normalizedVideo as any).encoder = "libx264";
    warnings.push("video.encoder is missing; defaulted to libx264");
  }

  const encoder = (normalizedVideo.encoder ?? "libx264") as EncoderType;
  const cap = getEncoderCapability(encoder);

  if (String(encoder) === "copy") {
    (normalizedVideo as any).rateControl = cap?.defaultRateControl ?? "cbr";
    normalizedVideo.qualityValue = 0;
    normalizedVideo.preset = "";
    return {
      preset: {
        ...preset,
        video: normalizedVideo,
      },
      diagnostics: { warnings },
    };
  }

  const rawRateControl = String((normalizedVideo as any).rateControl ?? "").trim();
  if (!rawRateControl) {
    (normalizedVideo as any).rateControl = cap?.defaultRateControl ?? "crf";
    warnings.push("video.rateControl is missing; defaulted by registry");
  }

  if (typeof normalizedVideo.qualityValue !== "number" || !Number.isFinite(normalizedVideo.qualityValue)) {
    normalizedVideo.qualityValue = cap?.defaultQualityValue ?? 23;
    warnings.push("video.qualityValue is missing; defaulted by registry");
  }

  const rawPreset = String((normalizedVideo as any).preset ?? "").trim();
  if (!rawPreset) {
    normalizedVideo.preset = cap?.defaultPreset ?? "medium";
    warnings.push("video.preset is missing; defaulted by registry");
  }

  return {
    preset: {
      ...preset,
      video: normalizedVideo,
    },
    diagnostics: { warnings },
  };
};

export const deriveVideoEditorModel = (preset: FFmpegPreset): VideoEditorModel => {
  const warnings: string[] = [];
  const encoder = (preset.video?.encoder ?? "libx264") as EncoderType;
  const cap = getEncoderCapability(encoder);

  const knownEncoders = getEncoderOptions().map((opt) => opt.value as string);
  const encoderOptions = (() => {
    const current = String(encoder ?? "") as EncoderType;
    const base = getEncoderOptions().map((opt) => ({ value: opt.value, label: opt.label }));
    if (!current || knownEncoders.includes(current as any)) return base;
    warnings.push(`Unknown encoder: ${current}`);
    return [{ value: current, label: toUnknownLabel(current), unknown: true }, ...base];
  })();

  const rateControl = (preset.video?.rateControl ?? cap?.defaultRateControl ?? "crf") as RateControlMode;
  const knownRateControls = cap?.rateControlModes ?? [];
  const { options: rateControlOptions, isUnknown: isUnknownRateControl } = ensureOptionsIncludeValue(
    knownRateControls as readonly RateControlMode[],
    rateControl,
  );
  if (isUnknownRateControl) warnings.push(`Unknown rate control: ${rateControl}`);

  const presetValue = String(preset.video?.preset ?? "");
  const knownPresets = cap?.presetOptions ?? [];
  const { options: presetOptions, isUnknown: isUnknownPreset } = ensureOptionsIncludeValue(knownPresets, presetValue);
  if (String(encoder) !== "copy" && presetOptions.length === 0)
    warnings.push(`Missing preset options for encoder: ${encoder}`);
  if (isUnknownPreset && presetValue) warnings.push(`Unknown preset: ${presetValue}`);

  return {
    encoderOptions,
    rateControlOptions,
    presetOptions,
    qualityRange: cap?.qualityRange ?? { min: 0, max: encoder === "libsvtav1" ? 63 : 51 },
    warnings,
  };
};
