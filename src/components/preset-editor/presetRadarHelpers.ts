import type { FFmpegPreset } from "@/types";
import { getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import type { VqPredictedMetrics } from "@/lib/vqResults/predict";

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp05 = (v: number) => (v < 0 ? 0 : v > 5 ? 5 : v);

export const computeQualityFromVq = (predicted: VqPredictedMetrics): number | null => {
  const vmaf = predicted.vmaf?.value;
  const ssim = predicted.ssim?.value;

  const parts: number[] = [];
  if (typeof vmaf === "number" && Number.isFinite(vmaf)) {
    // 80–100 mapped to 0–1
    parts.push(clamp01((vmaf - 80) / 20));
  }
  if (typeof ssim === "number" && Number.isFinite(ssim)) {
    // 0.95–1.00 mapped to 0–1
    parts.push(clamp01((ssim - 0.95) / 0.05));
  }
  if (parts.length === 0) return null;

  const n = parts.reduce((a, b) => a + b, 0) / parts.length;
  // Map to 1–5 to keep the radar semantics consistent with the existing UI.
  return clamp05(1 + 4 * n);
};

export type PresetStatsSummary = {
  speed: number | null;
  ratio: number | null;
  usageCount: number;
  totalInputSizeMB: number;
  totalTimeSeconds: number;
};

export const computePresetStatsSummary = (preset: FFmpegPreset): PresetStatsSummary => {
  const speed = getPresetAvgSpeed(preset);
  const ratio = getPresetAvgRatio(preset);
  const usageCount = preset.stats?.usageCount ?? 0;
  const totalInputSizeMB = preset.stats?.totalInputSizeMB ?? 0;
  const totalTimeSeconds = preset.stats?.totalTimeSeconds ?? 0;
  return {
    speed,
    ratio,
    usageCount,
    totalInputSizeMB,
    totalTimeSeconds,
  };
};

export const formatInputSize = (mb: number): string => {
  if (!Number.isFinite(mb) || mb <= 0) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)}GB`;
  return `${mb.toFixed(0)}MB`;
};

export const formatMbPerSec = (speed: number | null): string => {
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return "—";
  return `${speed.toFixed(2)}MB/s`;
};

export const formatPercent = (ratio: number | null): string => {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return "—";
  return `${ratio.toFixed(1)}%`;
};
