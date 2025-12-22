import type { AudioCodecType, VideoConfig } from "@/types";
import { stripQuotes } from "../utils";

export const parseEncoderType = (value: string): VideoConfig["encoder"] | null => {
  const raw = stripQuotes(value);
  const allowed: VideoConfig["encoder"][] = [
    "libx264",
    "libx265",
    "hevc_nvenc",
    "h264_nvenc",
    "av1_nvenc",
    "hevc_qsv",
    "av1_qsv",
    "hevc_amf",
    "av1_amf",
    "libsvtav1",
    "copy",
  ];
  return (allowed as string[]).includes(raw) ? (raw as VideoConfig["encoder"]) : null;
};

export const parseAudioCodecType = (value: string): AudioCodecType | null => {
  const raw = stripQuotes(value);
  return raw === "copy" || raw === "aac" ? (raw as AudioCodecType) : null;
};
