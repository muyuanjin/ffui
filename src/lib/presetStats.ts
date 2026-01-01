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
  const timeSeconds =
    typeof job.elapsedMs === "number" && Number.isFinite(job.elapsedMs) && job.elapsedMs > 0
      ? job.elapsedMs / 1000
      : job.startTime && job.endTime && job.endTime > job.startTime
        ? (job.endTime - job.startTime) / 1000
        : null;
  if (!timeSeconds || timeSeconds <= 0) return null;
  const frames =
    typeof job.mediaInfo?.durationSeconds === "number" &&
    typeof job.mediaInfo?.frameRate === "number" &&
    Number.isFinite(job.mediaInfo.durationSeconds) &&
    Number.isFinite(job.mediaInfo.frameRate) &&
    job.mediaInfo.durationSeconds > 0 &&
    job.mediaInfo.frameRate > 0
      ? job.mediaInfo.durationSeconds * job.mediaInfo.frameRate
      : typeof job.waitMetadata?.lastProgressFrame === "number" && Number.isFinite(job.waitMetadata.lastProgressFrame)
        ? job.waitMetadata.lastProgressFrame
        : 0;
  return { presetId: job.presetId, inputSizeMB, outputSizeMB, timeSeconds, frames };
};
