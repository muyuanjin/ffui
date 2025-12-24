import type { FFmpegPreset, TranscodeJob } from "@/types";

export const applyPresetStatsDelta = (
  presets: FFmpegPreset[],
  presetId: string,
  inputSizeMB: number,
  outputSizeMB: number,
  timeSeconds: number,
): FFmpegPreset[] => {
  return presets.map((preset) =>
    preset.id === presetId
      ? {
          ...preset,
          stats: {
            usageCount: preset.stats.usageCount + 1,
            totalInputSizeMB: preset.stats.totalInputSizeMB + inputSizeMB,
            totalOutputSizeMB: preset.stats.totalOutputSizeMB + outputSizeMB,
            totalTimeSeconds: preset.stats.totalTimeSeconds + timeSeconds,
          },
        }
      : preset,
  );
};

export const getPresetStatsDeltaFromJob = (
  job: TranscodeJob,
): { presetId: string; inputSizeMB: number; outputSizeMB: number; timeSeconds: number } | null => {
  const inputSizeMB = job.originalSizeMB;
  const outputSizeMB = job.outputSizeMB;
  if (!inputSizeMB || !outputSizeMB || inputSizeMB <= 0 || outputSizeMB <= 0) {
    return null;
  }
  if (!job.startTime || !job.endTime || job.endTime <= job.startTime) {
    return null;
  }
  const timeSeconds = (job.endTime - job.startTime) / 1000;
  return { presetId: job.presetId, inputSizeMB, outputSizeMB, timeSeconds };
};
