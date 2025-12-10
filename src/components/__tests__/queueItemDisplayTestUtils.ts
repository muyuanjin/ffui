import { createI18n } from "vue-i18n";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

export const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueueItem tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

export function makeJob(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/sample.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: basePreset.id,
    status: "completed",
    progress: 100,
    startTime: Date.now(),
    endTime: Date.now(),
    outputSizeMB: 5,
    logs: [],
    skipReason: undefined,
    ...overrides,
  };
}
