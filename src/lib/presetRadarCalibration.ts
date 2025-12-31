import type { FFmpegPreset } from "@/types";
import { getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import type { PresetRadar } from "@/lib/presetInsights";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const lowerBound = (sorted: number[], value: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const upperBound = (sorted: number[], value: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const percentileMidrank01 = (sorted: number[], value: number): number | null => {
  const n = sorted.length;
  if (n <= 0) return null;
  if (n === 1) return 0.5;
  const lo = lowerBound(sorted, value);
  const hi = upperBound(sorted, value);
  const midRank = (lo + (hi - 1)) / 2;
  return clamp01(midRank / (n - 1));
};

const score01ToRadar5 = (p01: number): number => 1 + 4 * clamp01(p01);

export const computeMeasuredRadarOverrides = (
  preset: FFmpegPreset,
  allPresets: FFmpegPreset[],
): Partial<PresetRadar> => {
  const speeds = allPresets
    .map((p) => getPresetAvgSpeed(p))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const ratios = allPresets
    .map((p) => getPresetAvgRatio(p))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const usages = allPresets
    .map((p) => p.stats?.usageCount ?? 0)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const overrides: Partial<PresetRadar> = {};

  const selfSpeed = getPresetAvgSpeed(preset);
  if (selfSpeed != null && selfSpeed > 0) {
    const p = percentileMidrank01(speeds, selfSpeed);
    if (p != null) overrides.speed = score01ToRadar5(p);
  }

  const selfRatio = getPresetAvgRatio(preset);
  if (selfRatio != null && selfRatio > 0) {
    const p = percentileMidrank01(ratios, selfRatio);
    if (p != null) overrides.sizeSaving = score01ToRadar5(1 - p);
  }

  const selfUsage = preset.stats?.usageCount ?? 0;
  if (selfUsage > 0) {
    const p = percentileMidrank01(usages, selfUsage);
    if (p != null) overrides.popularity = score01ToRadar5(p);
  } else {
    overrides.popularity = 0;
  }

  return overrides;
};
