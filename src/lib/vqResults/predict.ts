import type { FFmpegPreset } from "@/types";
import { getQualityRecommendation } from "@/lib/presetEditorContract/qualityRecommendations";
import { getQualityRangeForEncoder } from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import type { VqDataset, VqMetric, VqResultsSnapshot } from "./types";
import {
  computeMetricForDatasetKeyByQuality,
  computeMetricWithVariantRangeByQuality,
  estimateCurveQualityValue,
  getCurveQualitySpec,
} from "./curveQuality";
import { clamp, interpolateY } from "./interpolation";

export interface VqPredictedMetric {
  /** Averaged across set=1 and set=2 when both exist. */
  value: number;
  /** min/max across sets when both exist. */
  min?: number;
  max?: number;
}

export interface VqPredictedMetrics {
  /** The vq_results dataset key chosen for this preset. */
  datasetKey: string;
  /** Bitrate point used for curve sampling. */
  bitrateKbps: number;
  vmaf?: VqPredictedMetric;
  ssim?: VqPredictedMetric;
  fps?: VqPredictedMetric;
}

const buildIndex = (snapshot: VqResultsSnapshot): Map<string, VqDataset> => {
  const map = new Map<string, VqDataset>();
  for (const d of snapshot.datasets) {
    map.set(`${d.set}:${d.metric}:${d.key}`, d);
  }
  return map;
};

const nearestSvtPreset = (raw: string): "3" | "5" | "7" | "10" => {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return "7";
  if (n <= 4) return "3";
  if (n <= 6) return "5";
  if (n <= 8) return "7";
  return "10";
};

const collectCandidateDatasetKeys = (snapshot: VqResultsSnapshot, filter: string): string[] => {
  const keys = new Set<string>();
  for (const d of snapshot.datasets) {
    // Use vmaf curves as the baseline availability signal.
    if (d.metric !== "vmaf") continue;
    if (d.set !== 1 && d.set !== 2) continue;
    if (!d.key.includes(filter)) continue;
    keys.add(d.key);
  }
  return Array.from(keys);
};

const sortKeysLex = (keys: string[]) => keys.slice().sort((a, b) => a.localeCompare(b));

const chooseVqDatasetKey = (preset: FFmpegPreset): string | null => {
  const enc = String(preset.video?.encoder ?? "").toLowerCase();
  const presetValue = String(preset.video?.preset ?? "")
    .trim()
    .toLowerCase();
  const pixFmt = String(preset.video?.pixFmt ?? "").toLowerCase();
  const is10bit = pixFmt.includes("10") || pixFmt.includes("p010");

  if (enc === "libx264") {
    const slow = presetValue.includes("veryslow") || presetValue.includes("slower") || presetValue.includes("placebo");
    return slow ? "x264_veryslow_crf" : "x264_medium_crf";
  }

  if (enc === "libx265") {
    const slow = presetValue.includes("veryslow") || presetValue.includes("slower") || presetValue.includes("placebo");
    if (slow) return is10bit ? "x265_veryslow_10bit_crf" : "x265_veryslow_crf";
    return is10bit ? "x265_medium_10bit_crf" : "x265_medium_crf";
  }

  if (enc === "libsvtav1") {
    const bit = is10bit ? "10bit" : "8bit";
    const p = nearestSvtPreset(String(preset.video?.preset ?? ""));
    return `svtav1_${bit}_preset_${p}`;
  }

  return null;
};

const medianX = (points: { x: number; y: number }[]): number => {
  if (points.length === 0) return NaN;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)]!;
};

const estimateBitrateFromQuality = (preset: FFmpegPreset, vmafCurve: VqDataset): number => {
  const rec = getQualityRecommendation(preset.video.encoder);
  const base = medianX(vmafCurve.points);
  if (!Number.isFinite(base) || base <= 0) return 2000;

  const minX = vmafCurve.points[0]!.x;
  const maxX = vmafCurve.points[vmafCurve.points.length - 1]!.x;

  const capRange = getQualityRangeForEncoder(preset.video.encoder);
  const fallbackRange =
    capRange && Number.isFinite(capRange.min) && Number.isFinite(capRange.max) && capRange.max > capRange.min
      ? capRange
      : { min: 0, max: 51 };

  const rc = String(preset.video?.rateControl ?? "").toLowerCase();
  // vq_results curves do not encode a direct mapping between ffmpeg's CQ/QP/CRF
  // and bitrate points. We therefore:
  // - use a *recommended band* to normalize CQ/global_quality-like values,
  // - fall back to the encoder's full slider range for other cases (incl. ConstQP),
  // - and always sample within the curve's own bitrate span.
  const shouldUseRecommendedBand =
    rc !== "constqp" &&
    !!rec?.range &&
    Number.isFinite(rec.range.min) &&
    Number.isFinite(rec.range.max) &&
    rec.range.max > rec.range.min;

  const normRange = shouldUseRecommendedBand ? rec!.range : fallbackRange;

  // Map quality param onto a stable 0..1 position across the curve's bitrate span.
  // Lower qualityValue => higher bitrate (better quality), higher qualityValue => lower bitrate.
  const q = Number(preset.video?.qualityValue ?? rec?.target ?? 28);
  const t = clamp((q - normRange.min) / (normRange.max - normRange.min), 0, 1);
  // Do not stretch the full encoder range to the curve extremes; keep a
  // conservative band to reduce "wild" predictions for presets with no stats yet.
  const hi = 0.75;
  const lo = 0.35;
  const pos = hi - (hi - lo) * t; // t=0(best) => hi, t=1(worst) => lo
  const estimated = minX + (maxX - minX) * pos;
  return clamp(estimated, minX, maxX);
};

const computeMetricForDatasetKey = (
  idx: Map<string, VqDataset>,
  metric: VqMetric,
  datasetKey: string,
  bitrateKbps: number,
): VqPredictedMetric | null => {
  const allValues: number[] = [];

  for (const set of [1, 2] as const) {
    const d = idx.get(`${set}:${metric}:${datasetKey}`);
    if (!d) continue;
    const y = interpolateY(d.points, bitrateKbps);
    if (!Number.isFinite(y)) continue;
    allValues.push(y);
  }
  if (allValues.length === 0) return null;

  const sorted = allValues.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

  if (allValues.length >= 2) {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    return { value, min, max };
  }

  return { value };
};

const computeMetricWithVariantRange = (
  idx: Map<string, VqDataset>,
  metric: VqMetric,
  primaryKey: string,
  variantKeys: string[],
  bitrateKbps: number,
): VqPredictedMetric | null => {
  const primary = computeMetricForDatasetKey(idx, metric, primaryKey, bitrateKbps);
  if (!primary) return null;

  // Preserve the primary curve's value, but widen min/max using sibling curves
  // when they exist (so users can see the sensitivity without us averaging
  // across different preset families like "normal"/"quality").
  let min = primary.min ?? primary.value;
  let max = primary.max ?? primary.value;

  for (const key of variantKeys) {
    if (!key || key === primaryKey) continue;
    const sibling = computeMetricForDatasetKey(idx, metric, key, bitrateKbps);
    if (!sibling) continue;
    const sMin = sibling.min ?? sibling.value;
    const sMax = sibling.max ?? sibling.value;
    min = Math.min(min, sMin);
    max = Math.max(max, sMax);
  }

  if (min !== max) return { value: primary.value, min, max };
  return { value: primary.value };
};

export const predictFromVqResults = (
  snapshot: VqResultsSnapshot,
  preset: FFmpegPreset,
  options?: { datasetKeyOverride?: string | null; hardwareModelNameHint?: string | null },
): VqPredictedMetrics | null => {
  const idx = buildIndex(snapshot);

  const hasAnyMetric = (datasetKey: string): boolean => {
    for (const metric of ["vmaf", "ssim", "fps"] as const) {
      if (idx.get(`1:${metric}:${datasetKey}`) || idx.get(`2:${metric}:${datasetKey}`)) return true;
    }
    return false;
  };

  const override = String(options?.datasetKeyOverride ?? "").trim();
  const overrideKey = override && hasAnyMetric(override) ? override : "";

  const expandVariantKeys = (key: string): string[] => {
    const keys = [key];
    const sibling = key.endsWith("_quality")
      ? key.replace(/_quality$/, "_normal")
      : key.endsWith("_normal")
        ? key.replace(/_normal$/, "_quality")
        : null;
    if (sibling && hasAnyMetric(sibling)) keys.push(sibling);
    return keys;
  };

  const enc = String(preset.video?.encoder ?? "").toLowerCase();
  const pixFmt = String(preset.video?.pixFmt ?? "").toLowerCase();
  const is10bit = pixFmt.includes("10") || pixFmt.includes("p010");

  const extractNvVqModelId = (modelNameHint: string | null | undefined): string | null => {
    const raw = String(modelNameHint ?? "").trim();
    if (!raw) return null;
    const m = raw.match(/\b(rtx|gtx)\s*([0-9]{3,4})\b/i);
    if (!m) return null;
    return `${m[1]!.toLowerCase()}${m[2]!}`;
  };

  const chooseHardwareDatasetKeys = (): { primary: string; keys: string[] } | null => {
    const isNvenc = enc.includes("nvenc");
    const isQsv = enc.includes("_qsv");
    const isAmf = enc.includes("_amf");
    if (!isNvenc && !isQsv && !isAmf) return null;

    const codec = enc.includes("av1") ? "AV1" : enc.includes("hevc") ? "HEVC" : "H_264";

    const family = isNvenc ? "NVEncC" : isQsv ? "QSVEncC" : "VCEEncC";
    const nvModelHint = isNvenc ? extractNvVqModelId(options?.hardwareModelNameHint) : null;
    const models = isNvenc
      ? [nvModelHint, "rtx4080", "rtx5050", "rtx2070", "gtx1080", "gtx950"].filter((v): v is string => !!v)
      : isQsv
        ? ["u7_258v"]
        : ["rx7900xt", "rx5500xt"];

    // vq_results provides 10bit variants for NVEncC/QSVEncC HEVC/AV1, but not for H.264.
    // VCEEncC keys in vq_results currently do not encode bit depth in the dataset key.
    const bitSuffix = family === "VCEEncC" || codec === "H_264" ? "" : is10bit ? "_10bit" : "";

    const tryModel = (model: string) => {
      const base = `${model}_${family}_${codec}${bitSuffix}`;
      const normal = `${base}_normal`;
      const quality = `${base}_quality`;
      const keys: string[] = [];
      if (hasAnyMetric(normal)) keys.push(normal);
      if (hasAnyMetric(quality)) keys.push(quality);
      if (keys.length === 0) return null;
      const primary = keys.includes(normal) ? normal : keys[0]!;
      return { primary, keys };
    };

    for (const model of models) {
      const picked = tryModel(model);
      if (picked) return picked;
    }

    // Fallback: pick any available keys for this family+codec (and bitness when encoded).
    const filter = `_${family}_${codec}_`;
    const all = collectCandidateDatasetKeys(snapshot, filter).filter(hasAnyMetric);
    if (all.length === 0) return null;
    const filtered =
      family === "VCEEncC" || codec === "H_264"
        ? all
        : is10bit
          ? all.filter((k) => k.includes("_10bit"))
          : all.filter((k) => !k.includes("_10bit"));
    const keys = (filtered.length > 0 ? filtered : all).sort((a, b) => a.localeCompare(b));
    return { primary: keys[0]!, keys: keys.slice(0, 2) };
  };

  let datasetKey: string | null = null;
  let datasetKeys: string[] = [];

  if (overrideKey) {
    datasetKey = overrideKey;
    datasetKeys = expandVariantKeys(overrideKey);
  } else if (enc.includes("nvenc") || enc.includes("_qsv") || enc.includes("_amf")) {
    const picked = chooseHardwareDatasetKeys();
    datasetKey = picked?.primary ?? null;
    datasetKeys = picked?.keys ?? [];
  } else {
    const inferredKey = chooseVqDatasetKey(preset);

    // Prefer a dataset key that exists in the snapshot and matches the user's preset more closely.
    const tryChooseFromSnapshot = (): string | null => {
      const presetValue = String(preset.video?.preset ?? "")
        .trim()
        .toLowerCase();

      if (enc === "libx264") {
        const keys = sortKeysLex(collectCandidateDatasetKeys(snapshot, "x264_").filter(hasAnyMetric));
        if (keys.length === 0) return null;

        const p = presetValue || "medium";
        const isSlowFamily = p.includes("veryslow") || p.includes("slower") || p.includes("placebo");
        const candidates = [`x264_${p}_crf`, isSlowFamily ? "x264_veryslow_crf" : "", "x264_medium_crf"].filter(
          Boolean,
        );
        for (const c of candidates) if (hasAnyMetric(c)) return c;
        return keys.includes("x264_medium_crf") ? "x264_medium_crf" : keys[0]!;
      }

      if (enc === "libx265") {
        const keys = sortKeysLex(collectCandidateDatasetKeys(snapshot, "x265_").filter(hasAnyMetric));
        if (keys.length === 0) return null;

        const p = presetValue || "medium";
        const bitKey = (base: string) => (is10bit ? `${base}_10bit_crf` : `${base}_crf`);
        const isSlowFamily = p.includes("veryslow") || p.includes("slower") || p.includes("placebo");
        const candidates = [
          bitKey(`x265_${p}`),
          isSlowFamily ? bitKey("x265_veryslow") : "",
          bitKey("x265_medium"),
          is10bit ? "x265_medium_10bit_crf" : "x265_medium_crf",
        ].filter(Boolean);
        for (const c of candidates) if (hasAnyMetric(c)) return c;

        const medium = is10bit ? "x265_medium_10bit_crf" : "x265_medium_crf";
        return keys.includes(medium) ? medium : keys[0]!;
      }

      if (enc === "libsvtav1") {
        const keys = sortKeysLex(collectCandidateDatasetKeys(snapshot, "svtav1_").filter(hasAnyMetric));
        if (keys.length === 0) return null;
        const bit = is10bit ? "10bit" : "8bit";
        const p = nearestSvtPreset(String(preset.video?.preset ?? ""));
        const exact = `svtav1_${bit}_preset_${p}`;
        if (hasAnyMetric(exact)) return exact;
        return keys[0]!;
      }

      return null;
    };

    const inferredKeyOk = inferredKey && hasAnyMetric(inferredKey) ? inferredKey : null;
    datasetKey = tryChooseFromSnapshot() ?? inferredKeyOk ?? null;
    datasetKeys = datasetKey ? [datasetKey] : [];
  }

  if (!datasetKey || datasetKeys.length === 0) return null;

  const spec = getCurveQualitySpec(datasetKey);

  const pickBaselineDataset = (metric: VqMetric): VqDataset | null =>
    idx.get(`1:${metric}:${datasetKey}`) ??
    idx.get(`2:${metric}:${datasetKey}`) ??
    (datasetKeys.length > 1
      ? (idx.get(`1:${metric}:${datasetKeys[1]}`) ?? idx.get(`2:${metric}:${datasetKeys[1]}`))
      : null) ??
    null;

  const vmafCurve = pickBaselineDataset("vmaf");

  const baselineCurveForBitrateDomain = vmafCurve ?? pickBaselineDataset("ssim") ?? pickBaselineDataset("fps");

  const bitrateFromPreset = (() => {
    const raw = Number(preset.video?.bitrateKbps);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  })();

  const clampBitrateToCurve = (bitrateKbps: number): number => {
    const curve = baselineCurveForBitrateDomain;
    if (!curve) return bitrateKbps;
    const minX = curve.points[0]!.x;
    const maxX = curve.points[curve.points.length - 1]!.x;
    return clamp(bitrateKbps, minX, maxX);
  };

  const qCurve = spec ? estimateCurveQualityValue(preset, spec) : NaN;

  const useQualityPath =
    !!spec &&
    bitrateFromPreset == null &&
    Number.isFinite(qCurve) &&
    // Require at least one baseline dataset so we can align the axis length.
    !!vmafCurve &&
    // Guard: with too few points we cannot reliably align the upstream quality axis
    // after the bitrate cut, so fall back to bitrate-domain sampling.
    vmafCurve.points.length >= 4;

  const predictedByQuality = useQualityPath
    ? {
        bitrateKbpsPred:
          computeMetricForDatasetKeyByQuality(idx, "vmaf", datasetKey, qCurve, spec)?.bitrateKbps ??
          computeMetricForDatasetKeyByQuality(idx, "ssim", datasetKey, qCurve, spec)?.bitrateKbps ??
          computeMetricForDatasetKeyByQuality(idx, "fps", datasetKey, qCurve, spec)?.bitrateKbps ??
          null,
        vmaf: computeMetricWithVariantRangeByQuality(idx, "vmaf", datasetKey, datasetKeys, qCurve, spec)?.metric,
        ssim: computeMetricWithVariantRangeByQuality(idx, "ssim", datasetKey, datasetKeys, qCurve, spec)?.metric,
        fps: computeMetricWithVariantRangeByQuality(idx, "fps", datasetKey, datasetKeys, qCurve, spec)?.metric,
      }
    : null;

  const bitrateKbps = (() => {
    if (bitrateFromPreset != null) return clampBitrateToCurve(bitrateFromPreset);
    if (predictedByQuality?.bitrateKbpsPred) return predictedByQuality.bitrateKbpsPred.value;
    return baselineCurveForBitrateDomain ? estimateBitrateFromQuality(preset, baselineCurveForBitrateDomain) : 2000;
  })();

  const vmaf =
    predictedByQuality?.vmaf ??
    computeMetricWithVariantRange(idx, "vmaf", datasetKey, datasetKeys, bitrateKbps) ??
    undefined;
  const ssim =
    predictedByQuality?.ssim ??
    computeMetricWithVariantRange(idx, "ssim", datasetKey, datasetKeys, bitrateKbps) ??
    undefined;
  const fps =
    predictedByQuality?.fps ??
    computeMetricWithVariantRange(idx, "fps", datasetKey, datasetKeys, bitrateKbps) ??
    undefined;

  if (!vmaf && !ssim && !fps) return null;

  return { datasetKey, bitrateKbps, vmaf, ssim, fps };
};
