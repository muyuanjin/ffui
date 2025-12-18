import type { EncoderType, BatchCompressConfig } from "./types";
import { DEFAULT_OUTPUT_POLICY } from "./types/output-policy";

export const ENCODER_OPTIONS: { value: EncoderType; label: string; hardware: boolean }[] = [
  { value: "libx264", label: "H.264 Software (libx264) - Best Compatibility", hardware: false },
  { value: "hevc_nvenc", label: "H.265 NVIDIA (hevc_nvenc) - High Speed", hardware: true },
  { value: "libsvtav1", label: "AV1 (libsvtav1) - High Efficiency", hardware: false },
  { value: "copy", label: "Stream Copy (No Transcoding) - Instant", hardware: false },
];

export const PRESET_OPTIONS: Record<string, string[]> = {
  libx264: ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
  hevc_nvenc: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  libsvtav1: ["13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"],
};

export const GUIDE_TIPS = {
  crf_x264: "Constant Rate Factor (0-51). Lower is better quality. Recommended: 18-22 for Archive, 23-24 for Balance.",
  cq_nvenc: "Constant Quality (0-51). NOT comparable to CRF. Rec: 26-28 for good visual quality.",
  crf_av1: "AV1 CRF (0-63). Rec: 32-34 matches x264 CRF 23.",
  preset_x264: "'medium' is balanced. 'slow' gives smaller files for same quality.",
  preset_nvenc: "'p7' is best quality, 'p1' is fastest.",
  preset_av1: "Higher numbers are FASTER. Rec: 4-6 for balance.",
  audio_copy: "Always recommended unless format conversion is strictly needed. 0% quality loss.",
};

export const EXTENSIONS = {
  images: [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"],
  videos: [".mp4", ".mkv", ".mov", ".avi", ".flv", ".ts", ".m2ts", ".wmv", ".webm", ".m4v"],
  audios: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus"],
};

/** 视频文件扩展名（不含点号） */
export const VIDEO_EXTENSIONS = ["mp4", "mkv", "mov", "avi", "flv", "ts", "m2ts", "wmv", "webm", "m4v"];

/** 图片文件扩展名（不含点号） */
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp", "gif"];

/** 音频文件扩展名（不含点号） */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"];

export const DEFAULT_BATCH_COMPRESS_CONFIG: BatchCompressConfig = {
  rootPath: "",
  replaceOriginal: true,
  minImageSizeKB: 50,
  minVideoSizeMB: 50,
  minAudioSizeKB: 500,
  savingConditionType: "ratio",
  minSavingRatio: 0.95,
  minSavingAbsoluteMB: 5,
  imageTargetFormat: "avif",
  videoPresetId: "",
  audioPresetId: "",
  outputPolicy: DEFAULT_OUTPUT_POLICY,
  videoFilter: {
    enabled: true,
    extensions: [...VIDEO_EXTENSIONS],
  },
  imageFilter: {
    enabled: true,
    extensions: [...IMAGE_EXTENSIONS],
  },
  audioFilter: {
    enabled: false,
    extensions: [...AUDIO_EXTENSIONS],
  },
};
