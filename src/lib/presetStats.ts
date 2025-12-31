import type { FFmpegPreset, TranscodeJob } from "@/types";

export const makeZeroPresetStats = (): FFmpegPreset["stats"] => ({
  usageCount: 0,
  totalInputSizeMB: 0,
  totalOutputSizeMB: 0,
  totalTimeSeconds: 0,
  totalFrames: 0,
});

export const applyPresetStatsDelta = (
  presets: FFmpegPreset[],
  presetId: string,
  inputSizeMB: number,
  outputSizeMB: number,
  timeSeconds: number,
  frames: number,
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
            totalFrames: (preset.stats.totalFrames ?? 0) + (Number.isFinite(frames) && frames > 0 ? frames : 0),
          },
        }
      : preset,
  );
};

export const getPresetStatsDeltaFromJob = (
  job: TranscodeJob,
): { presetId: string; inputSizeMB: number; outputSizeMB: number; timeSeconds: number; frames: number } | null => {
  const inputSizeMB = job.originalSizeMB;
  const outputSizeMB = job.outputSizeMB;
  if (!inputSizeMB || !outputSizeMB || inputSizeMB <= 0 || outputSizeMB <= 0) {
    return null;
  }
  if (!job.startTime || !job.endTime || job.endTime <= job.startTime) {
    return null;
  }
  const timeSeconds = (job.endTime - job.startTime) / 1000;
  const frames =
    typeof job.waitMetadata?.lastProgressFrame === "number" && Number.isFinite(job.waitMetadata.lastProgressFrame)
      ? job.waitMetadata.lastProgressFrame
      : typeof job.mediaInfo?.durationSeconds === "number" &&
          typeof job.mediaInfo?.frameRate === "number" &&
          Number.isFinite(job.mediaInfo.durationSeconds) &&
          Number.isFinite(job.mediaInfo.frameRate)
        ? job.mediaInfo.durationSeconds > 0 && job.mediaInfo.frameRate > 0
          ? job.mediaInfo.durationSeconds * job.mediaInfo.frameRate
          : 0
        : 0;
  return { presetId: job.presetId, inputSizeMB, outputSizeMB, timeSeconds, frames };
};
