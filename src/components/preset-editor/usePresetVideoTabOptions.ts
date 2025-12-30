import { computed } from "vue";
import type { DeepWritable, EncoderType, RateControlMode, VideoConfig } from "@/types";
import {
  getEncoderCapability,
  getEncoderOptions,
  getQualityRangeForEncoder,
} from "@/lib/presetEditorContract/encoderCapabilityRegistry";

type Translate = (key: string, params?: Record<string, unknown>) => string;
type EncoderOption = { value: EncoderType; label: string; unknown?: boolean };

export const usePresetVideoTabOptions = (video: DeepWritable<VideoConfig>, t: Translate) => {
  const toUnknownLabel = (value: string) => t("presetEditor.video.unknownOption", { value });

  const encoderOptionsWithUnknown = computed(() => {
    const base: EncoderOption[] = getEncoderOptions().map((opt) => ({ value: opt.value, label: opt.label }));
    const current = String(video.encoder ?? "").trim();
    if (!current) return base;
    if (base.some((opt) => String(opt.value) === current)) return base;
    return [{ value: current as EncoderType, label: toUnknownLabel(current), unknown: true }, ...base];
  });

  const currentEncoderLabel = computed(() => {
    const current = String(video.encoder ?? "").trim();
    const match = encoderOptionsWithUnknown.value.find((opt) => String(opt.value) === current);
    return match?.label ?? (current ? toUnknownLabel(current) : "");
  });

  const rateControlOptionsForEncoder = computed(() => {
    const cap = getEncoderCapability(video.encoder);
    const known = (cap?.rateControlModes ?? []).map((m) => String(m));
    const current = String(video.rateControl ?? "").trim();
    if (!current) return known.length > 0 ? known : ["crf"];
    if (known.includes(current)) return known;
    return [current, ...known];
  });

  const knownRateControlSet = computed(() => {
    const cap = getEncoderCapability(video.encoder);
    return new Set((cap?.rateControlModes ?? []).map((m) => String(m) as RateControlMode));
  });

  const presetOptionsForEncoder = computed(() => {
    const cap = getEncoderCapability(video.encoder);
    const known = [...(cap?.presetOptions ?? [])];
    const current = String(video.preset ?? "").trim();
    if (!current || known.includes(current)) return known;
    return [current, ...known];
  });

  const knownPresetSet = computed(() => {
    const cap = getEncoderCapability(video.encoder);
    return new Set([...(cap?.presetOptions ?? [])]);
  });

  const qualityRange = computed(() => getQualityRangeForEncoder(video.encoder));

  return {
    toUnknownLabel,
    encoderOptionsWithUnknown,
    currentEncoderLabel,
    rateControlOptionsForEncoder,
    knownRateControlSet,
    presetOptionsForEncoder,
    knownPresetSet,
    qualityRange,
  };
};
