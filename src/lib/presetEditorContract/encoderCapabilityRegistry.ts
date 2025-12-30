import type { EncoderType, RateControlMode, VideoConfig } from "@/types";

export interface EncoderCapability {
  encoder: string;
  label: string;
  hardware: boolean;
  rateControlModes: readonly RateControlMode[];
  presetOptions: readonly string[];
  tuneOptions: readonly string[];
  defaultRateControl: RateControlMode;
  defaultQualityValue: number;
  defaultPreset: string;
  qualityRange: {
    min: number;
    max: number;
  };
}

const X264_ONLY_TUNES = [
  "film",
  "animation",
  "grain",
  "stillimage",
  "psnr",
  "ssim",
  "fastdecode",
  "zerolatency",
] as const;

const NVENC_PRESETS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] as const;
const X26X_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;
const X265_PRESETS = [...X26X_PRESETS, "placebo"] as const;
const QSV_PRESETS = ["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
const AMF_PRESETS = ["speed", "balanced", "quality"] as const;
const SVT_AV1_PRESETS = ["13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"] as const;

const CAPABILITIES: readonly EncoderCapability[] = [
  {
    encoder: "libx264",
    label: "H.264 Software (libx264) - Best Compatibility",
    hardware: false,
    rateControlModes: ["crf", "vbr", "cbr"],
    defaultRateControl: "crf",
    defaultQualityValue: 23,
    qualityRange: { min: 0, max: 51 },
    presetOptions: X26X_PRESETS,
    defaultPreset: "medium",
    tuneOptions: X264_ONLY_TUNES,
  },
  {
    encoder: "libx265",
    label: "H.265 Software (libx265) - High Efficiency",
    hardware: false,
    rateControlModes: ["crf", "vbr", "cbr"],
    defaultRateControl: "crf",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: X265_PRESETS,
    defaultPreset: "slow",
    tuneOptions: [],
  },
  {
    encoder: "h264_nvenc",
    label: "H.264 NVIDIA (h264_nvenc) - High Speed",
    hardware: true,
    rateControlModes: ["cq", "constqp", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: NVENC_PRESETS,
    defaultPreset: "p5",
    tuneOptions: ["hq"],
  },
  {
    encoder: "hevc_nvenc",
    label: "H.265 NVIDIA (hevc_nvenc) - High Speed",
    hardware: true,
    rateControlModes: ["cq", "constqp", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: NVENC_PRESETS,
    defaultPreset: "p5",
    tuneOptions: ["hq"],
  },
  {
    encoder: "av1_nvenc",
    label: "AV1 NVIDIA (av1_nvenc) - High Efficiency",
    hardware: true,
    rateControlModes: ["cq", "constqp", "vbr", "cbr"],
    defaultRateControl: "constqp",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: NVENC_PRESETS,
    defaultPreset: "p7",
    tuneOptions: ["hq"],
  },
  {
    encoder: "hevc_qsv",
    label: "H.265 Intel (hevc_qsv) - Quick Sync",
    hardware: true,
    rateControlModes: ["cq", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: QSV_PRESETS,
    defaultPreset: "medium",
    tuneOptions: [],
  },
  {
    encoder: "av1_qsv",
    label: "AV1 Intel (av1_qsv) - Quick Sync",
    hardware: true,
    rateControlModes: ["cq", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 34,
    qualityRange: { min: 0, max: 51 },
    presetOptions: QSV_PRESETS,
    defaultPreset: "slow",
    tuneOptions: [],
  },
  {
    encoder: "hevc_amf",
    label: "H.265 AMD (hevc_amf) - AMF",
    hardware: true,
    rateControlModes: ["cq", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 28,
    qualityRange: { min: 0, max: 51 },
    presetOptions: AMF_PRESETS,
    defaultPreset: "balanced",
    tuneOptions: [],
  },
  {
    encoder: "av1_amf",
    label: "AV1 AMD (av1_amf) - AMF",
    hardware: true,
    rateControlModes: ["cq", "vbr", "cbr"],
    defaultRateControl: "cq",
    defaultQualityValue: 34,
    qualityRange: { min: 0, max: 51 },
    presetOptions: AMF_PRESETS,
    defaultPreset: "balanced",
    tuneOptions: [],
  },
  {
    encoder: "libsvtav1",
    label: "AV1 (libsvtav1) - High Efficiency",
    hardware: false,
    rateControlModes: ["crf", "vbr", "cbr"],
    defaultRateControl: "crf",
    defaultQualityValue: 34,
    qualityRange: { min: 0, max: 63 },
    presetOptions: SVT_AV1_PRESETS,
    defaultPreset: "5",
    tuneOptions: [],
  },
  {
    encoder: "copy",
    label: "Stream Copy (No Transcoding) - Instant",
    hardware: false,
    rateControlModes: ["cbr"],
    defaultRateControl: "cbr",
    defaultQualityValue: 0,
    qualityRange: { min: 0, max: 0 },
    presetOptions: [],
    defaultPreset: "",
    tuneOptions: [],
  },
] as const;

const CAPABILITY_BY_ENCODER = new Map<string, EncoderCapability>(CAPABILITIES.map((c) => [c.encoder, c]));

export const getEncoderCapability = (encoder: EncoderType): EncoderCapability | null => {
  const key = String(encoder ?? "").trim();
  return CAPABILITY_BY_ENCODER.get(key) ?? null;
};

export const getEncoderOptions = (): { value: EncoderType; label: string; hardware: boolean }[] => {
  return CAPABILITIES.map((c) => ({ value: c.encoder as EncoderType, label: c.label, hardware: c.hardware }));
};

export const getPresetOptionsByEncoder = (): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const cap of CAPABILITIES) {
    out[cap.encoder] = [...cap.presetOptions];
  }
  return out;
};

export const getRateControlModesForEncoder = (encoder: EncoderType): readonly RateControlMode[] => {
  return getEncoderCapability(encoder)?.rateControlModes ?? [];
};

export const getQualityRangeForEncoder = (encoder: EncoderType): { min: number; max: number } => {
  return getEncoderCapability(encoder)?.qualityRange ?? { min: 0, max: 51 };
};

export const getCqArgumentForEncoder = (encoder: EncoderType): "-cq" | "-global_quality" => {
  const raw = String(encoder ?? "").toLowerCase();
  if (raw.includes("_qsv")) return "-global_quality";
  return "-cq";
};

export const normalizeVideoForSave = (video: VideoConfig): VideoConfig => {
  const normalized: VideoConfig = { ...(video as VideoConfig) };

  if (normalized.encoder !== "libx264") {
    const rawTune = typeof normalized.tune === "string" ? normalized.tune.trim() : "";
    if (rawTune && (X264_ONLY_TUNES as readonly string[]).includes(rawTune)) {
      delete normalized.tune;
    }
  }

  if (normalized.encoder === "copy") {
    normalized.bitrateKbps = undefined;
    normalized.maxBitrateKbps = undefined;
    normalized.bufferSizeKbits = undefined;
    normalized.pass = undefined;
  }

  return normalized;
};

export const applyEncoderChangePatch = (current: VideoConfig, nextEncoder: EncoderType): Partial<VideoConfig> => {
  const cap = getEncoderCapability(nextEncoder);
  const nextRateControl = cap?.rateControlModes.includes(current.rateControl)
    ? current.rateControl
    : cap?.defaultRateControl;
  const rateControl = (nextRateControl ?? cap?.defaultRateControl ?? "crf") as RateControlMode;

  const nextPreset = (() => {
    const raw = String(current.preset ?? "").trim();
    if (!cap) return raw;
    if (!raw) return cap.defaultPreset;
    if (cap.presetOptions.includes(raw)) return raw;
    return raw;
  })();

  const nextQualityValue = (() => {
    const range = cap?.qualityRange ?? { min: 0, max: 51 };
    const raw = typeof current.qualityValue === "number" ? current.qualityValue : (cap?.defaultQualityValue ?? 23);
    const clamped = Math.max(range.min, Math.min(range.max, raw));
    if (Number.isFinite(clamped)) return clamped;
    return cap?.defaultQualityValue ?? 23;
  })();

  const patch: Partial<VideoConfig> = {
    encoder: nextEncoder,
    rateControl,
    qualityValue: nextQualityValue,
    preset: nextEncoder === "copy" ? "" : nextPreset,
  };

  if (nextEncoder !== "libx264") {
    // Avoid carrying obvious x264-only tune values into other encoders.
    const rawTune = typeof current.tune === "string" ? current.tune.trim() : "";
    if (rawTune && (X264_ONLY_TUNES as readonly string[]).includes(rawTune)) {
      patch.tune = undefined;
    }
  }

  if (nextEncoder === "copy") {
    patch.bitrateKbps = undefined;
    patch.maxBitrateKbps = undefined;
    patch.bufferSizeKbits = undefined;
    patch.pass = undefined;
  } else if (rateControl === "crf" || rateControl === "cq" || rateControl === "constqp") {
    patch.bitrateKbps = undefined;
    patch.maxBitrateKbps = undefined;
    patch.bufferSizeKbits = undefined;
    patch.pass = undefined;
  }

  return patch;
};

export const applyRateControlChangePatch = (nextRateControl: RateControlMode): Partial<VideoConfig> => {
  if (nextRateControl === "crf" || nextRateControl === "cq" || nextRateControl === "constqp") {
    return {
      rateControl: nextRateControl,
      bitrateKbps: undefined,
      maxBitrateKbps: undefined,
      bufferSizeKbits: undefined,
      pass: undefined,
    };
  }
  return { rateControl: nextRateControl };
};
