import type { EncoderType } from "@/types";

export type QualityArgKind = "crf" | "cq" | "global_quality" | "amf_qp";

export interface QualityRecommendation {
  /** Which ffmpeg argument(s) this encoder expects for "quality-first" workflows. */
  argKind: QualityArgKind;
  /** Recommended range for typical daily use (inclusive). */
  range: { min: number; max: number };
  /** Suggested starting value when range is a band. */
  target: number;
}

/**
 * Recommended quality ranges based on the user's requested equivalence table:
 * - libx264 -crf 24
 * = libx265 -crf 25
 * = libsvtav1 -crf 30~34
 * = h264_qsv -global_quality 24
 * = hevc_qsv -global_quality 23~24
 * = h264_nvenc -cq 28~30
 * = hevc_nvenc -cq 28~30
 * = av1_nvenc -cq 34~36
 * = h264_amf -qp_i 28 -qp_p 28
 * = hevc_amf -qp_i 28 -qp_p 28
 */
export const getQualityRecommendation = (encoder: EncoderType): QualityRecommendation | null => {
  const enc = String(encoder ?? "").toLowerCase();
  if (!enc) return null;

  if (enc === "libx264") {
    return { argKind: "crf", range: { min: 24, max: 24 }, target: 24 };
  }
  if (enc === "libx265") {
    return { argKind: "crf", range: { min: 25, max: 25 }, target: 25 };
  }
  if (enc === "libsvtav1") {
    return { argKind: "crf", range: { min: 30, max: 34 }, target: 32 };
  }

  if (enc === "h264_nvenc" || enc === "hevc_nvenc") {
    return { argKind: "cq", range: { min: 28, max: 30 }, target: 29 };
  }
  if (enc === "av1_nvenc") {
    return { argKind: "cq", range: { min: 34, max: 36 }, target: 35 };
  }

  if (enc === "hevc_qsv") {
    return { argKind: "global_quality", range: { min: 23, max: 24 }, target: 24 };
  }
  if (enc === "av1_qsv") {
    return { argKind: "global_quality", range: { min: 34, max: 34 }, target: 34 };
  }

  if (enc === "hevc_amf" || enc === "av1_amf") {
    return { argKind: "amf_qp", range: { min: 28, max: 28 }, target: 28 };
  }

  return null;
};
