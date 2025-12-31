import { computed } from "vue";
import type { DeepWritable, EncoderType, RateControlMode, VideoConfig } from "@/types";
import {
  getEncoderCapability,
  getEncoderOptions,
  getQualityRangeForEncoder,
} from "@/lib/presetEditorContract/encoderCapabilityRegistry";

type Translate = (key: string, params?: Record<string, unknown>) => string;
export type EncoderCodecTag = "h264" | "h265" | "av1" | "copy" | "other";
type EncoderOption = {
  value: EncoderType;
  label: string;
  hardware: boolean;
  codecTag: EncoderCodecTag;
  unknown?: boolean;
};

const getCodecTagForEncoder = (encoder: string): EncoderCodecTag => {
  const raw = String(encoder ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "other";
  if (raw === "copy") return "copy";
  if (raw === "libx264" || raw.startsWith("h264_")) return "h264";
  if (raw === "libx265" || raw.startsWith("hevc_")) return "h265";
  if (raw.includes("av1") || raw === "libsvtav1") return "av1";
  return "other";
};

export const usePresetVideoTabOptions = (video: DeepWritable<VideoConfig>, t: Translate) => {
  const toUnknownLabel = (value: string) => t("presetEditor.video.unknownOption", { value });

  const encoderOptionsWithUnknown = computed(() => {
    const base: EncoderOption[] = getEncoderOptions().map((opt) => ({
      value: opt.value,
      label: opt.label,
      hardware: opt.hardware,
      codecTag: getCodecTagForEncoder(String(opt.value)),
    }));
    const current = String(video.encoder ?? "").trim();
    if (!current) return base;
    if (base.some((opt) => String(opt.value) === current)) return base;
    return [
      {
        value: current as EncoderType,
        label: toUnknownLabel(current),
        hardware: false,
        codecTag: getCodecTagForEncoder(current),
        unknown: true,
      },
      ...base,
    ];
  });

  const currentEncoderLabel = computed(() => {
    const current = String(video.encoder ?? "").trim();
    const match = encoderOptionsWithUnknown.value.find((opt) => String(opt.value) === current);
    return match?.label ?? (current ? toUnknownLabel(current) : "");
  });

  const encoderOptionGroups = computed(() => {
    const groups: Record<EncoderCodecTag, EncoderOption[]> = { h264: [], h265: [], av1: [], copy: [], other: [] };
    for (const opt of encoderOptionsWithUnknown.value) {
      groups[opt.codecTag].push(opt);
    }
    return [
      { tag: "h264" as const, options: groups.h264 },
      { tag: "h265" as const, options: groups.h265 },
      { tag: "av1" as const, options: groups.av1 },
      { tag: "copy" as const, options: groups.copy },
      { tag: "other" as const, options: groups.other },
    ];
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
    encoderOptionGroups,
    currentEncoderLabel,
    rateControlOptionsForEncoder,
    knownRateControlSet,
    presetOptionsForEncoder,
    knownPresetSet,
    qualityRange,
  };
};
