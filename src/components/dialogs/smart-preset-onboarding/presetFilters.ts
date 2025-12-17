import type { FFmpegPreset } from "@/types";

export type CodecPreference = "auto" | "h264" | "hevc" | "av1";
export type UseCasePreference = "share" | "daily" | "archive";

export const classifyCodec = (encoder: string): CodecPreference | "other" => {
  const lower = encoder.toLowerCase();
  if (lower.includes("x264")) return "h264";
  if (lower.includes("hevc") || lower.includes("h265")) return "hevc";
  if (lower.includes("av1")) return "av1";
  return "other";
};

export const classifyUseCase = (preset: FFmpegPreset, resolvedDescription: string): UseCasePreference => {
  const text = `${preset.id} ${preset.name} ${resolvedDescription}`.toLowerCase();
  if (text.includes("archive") || text.includes("归档") || text.includes("visually")) {
    return "archive";
  }
  if (text.includes("fast") || text.includes("share") || text.includes("分享")) {
    return "share";
  }
  return "daily";
};

export const isAdvancedPreset = (preset: FFmpegPreset, resolvedDescription: string): boolean => {
  const encoder = String(preset.video?.encoder ?? "").toLowerCase();
  const rc = preset.video?.rateControl ?? "crf";
  const q = preset.video?.qualityValue ?? 0;
  const text = `${preset.id} ${preset.name} ${resolvedDescription}`.toLowerCase();

  if (encoder.includes("qsv") || encoder.includes("amf")) return true;
  if (encoder.includes("libsvtav1")) return true;
  if (rc === "constqp" && q <= 22) return true;
  if (
    text.includes("无损") ||
    text.includes("visually") ||
    text.includes("实验") ||
    text.includes("experimental")
  ) {
    return true;
  }

  return false;
};

