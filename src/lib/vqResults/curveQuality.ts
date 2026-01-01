import type { FFmpegPreset } from "@/types";
import { getQualityRecommendation } from "@/lib/presetEditorContract/qualityRecommendations";
import { getQualityRangeForEncoder } from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import type { VqDataset, VqMetric } from "./types";
import { clamp, interpolateY } from "./interpolation";

export type VqPredictedRange = { value: number; min?: number; max?: number };

type CurveQualityDirection = "lower_is_better" | "higher_is_better";

export type CurveQualitySpec = { axis: number[]; direction: CurveQualityDirection; domain: "crf" | "svt_crf" | "qvbr" };

export const getCurveQualitySpec = (datasetKey: string): CurveQualitySpec | null => {
  const key = String(datasetKey ?? "");
  if (!key) return null;

  // CPU encoders (direct CRF match).
  if ((key.startsWith("x264_") || key.startsWith("x265_")) && key.endsWith("_crf")) {
    return { axis: [16, 20, 24, 28, 32, 36, 40], direction: "lower_is_better", domain: "crf" };
  }
  if (key.startsWith("svtav1_")) {
    // svtav1 in vq_results is driven by --crf, not qvbr.
    return { axis: [18, 24, 30, 36, 42, 48, 54, 60], direction: "lower_is_better", domain: "svt_crf" };
  }

  // HW encoders in vq_results use QVBR for "Const. Quality" mode (NVEncC/QSVEncC/VCEEncC).
  if (key.includes("_NVEncC_") && key.includes("_AV1_")) {
    return { axis: [16, 22, 28, 34, 40, 46, 52, 58], direction: "lower_is_better", domain: "qvbr" };
  }
  if (key.includes("_NVEncC_")) {
    return { axis: [16, 20, 24, 28, 32, 36, 40], direction: "lower_is_better", domain: "qvbr" };
  }
  if (key.includes("_QSVEncC_")) {
    return { axis: [16, 20, 24, 28, 32, 36, 40], direction: "lower_is_better", domain: "qvbr" };
  }
  if (key.includes("_VCEEncC_")) {
    // VCEEncC (AMF) uses a different direction in vq_results (higher values yield higher bitrate/quality).
    return { axis: [14, 20, 26, 32, 38, 44, 50], direction: "higher_is_better", domain: "qvbr" };
  }

  return null;
};

const sliceQualityAxisForPoints = (spec: Pick<CurveQualitySpec, "axis" | "direction">, count: number): number[] => {
  const axis = spec.axis;
  if (count <= 0) return [];
  if (count >= axis.length) return axis.slice();

  // vq_results_data.js is generated with a max bitrate cut (default 8000kbps),
  // which tends to drop the "highest bitrate" end:
  // - when lower is better (x264/x265/NVEncC/QSVEncC), the best settings sit at the low end => drop from start.
  // - when higher is better (VCEEncC), the best settings sit at the high end => drop from end.
  return spec.direction === "lower_is_better" ? axis.slice(axis.length - count) : axis.slice(0, count);
};

export const getQualityAxisForPointsCount = (
  spec: Pick<CurveQualitySpec, "axis" | "direction">,
  count: number,
): number[] => {
  return sliceQualityAxisForPoints(spec, count);
};

export const estimateCurveQualityValue = (
  preset: FFmpegPreset,
  spec: CurveQualitySpec,
  options?: { pointsCount?: number | null },
): number => {
  const axis =
    typeof options?.pointsCount === "number" && Number.isFinite(options.pointsCount) && options.pointsCount > 0
      ? sliceQualityAxisForPoints(spec, options.pointsCount)
      : spec.axis;
  if (axis.length === 0) return NaN;

  const qRaw = preset.video?.qualityValue;
  const hasExplicitQualityValue = typeof qRaw === "number" && Number.isFinite(qRaw);
  const q = Number(qRaw);

  // If the dataset uses CRF and the preset is already CRF-driven, we can map
  // 1:1 (clamped to the known upstream quality axis).
  const rc = String(preset.video?.rateControl ?? "").toLowerCase();
  if ((spec.domain === "crf" || spec.domain === "svt_crf") && rc === "crf" && Number.isFinite(q)) {
    return clamp(q, axis[0]!, axis[axis.length - 1]!);
  }
  // vq_results' HW curves are driven by a QVBR-like quality parameter. For
  // ffmpeg constqp presets, treating `qualityValue` as QP-like and clamping
  // directly onto the (possibly truncated) axis avoids "mid-range" mapping
  // that severely underestimates near-lossless presets.
  if (spec.domain === "qvbr" && rc === "constqp" && Number.isFinite(q)) {
    return clamp(q, axis[0]!, axis[axis.length - 1]!);
  }

  // Otherwise, map the preset's quality scale onto the curve axis conservatively.
  const rec = getQualityRecommendation(preset.video.encoder);
  const capRange = getQualityRangeForEncoder(preset.video.encoder);
  const fallbackRange =
    capRange && Number.isFinite(capRange.min) && Number.isFinite(capRange.max) && capRange.max > capRange.min
      ? capRange
      : { min: 0, max: 51 };

  const shouldUseRecommendedBand =
    rc !== "constqp" &&
    !!rec?.range &&
    Number.isFinite(rec.range.min) &&
    Number.isFinite(rec.range.max) &&
    rec.range.max > rec.range.min;

  // IMPORTANT: `rec.range` is a *recommended* daily-use band, not the scale's
  // full domain. When users explicitly provide a qualityValue (e.g. CQ 20),
  // do not clamp it into the tiny recommended band (e.g. 28–30), otherwise
  // values outside the band saturate and break monotonicity.
  const normRange = !hasExplicitQualityValue && shouldUseRecommendedBand ? rec!.range : fallbackRange;

  const qPreset = hasExplicitQualityValue ? q : Number(rec?.target ?? 28);
  const t = (() => {
    const span = normRange.max - normRange.min;
    if (!Number.isFinite(span) || span <= 0) return 0.5;

    // Hardware CQ scales often behave non-linearly: values much better than the
    // typical target (e.g. CQ20 vs CQ29) should move closer to the curve's best
    // end, while values near the target should remain stable.
    if (
      spec.domain === "qvbr" &&
      rc === "cq" &&
      hasExplicitQualityValue &&
      rec &&
      Number.isFinite(rec.target) &&
      Math.abs(qPreset - rec.target) >= 3
    ) {
      const scale = 6;
      const z = (qPreset - rec.target) / scale;
      const logistic = 1 / (1 + Math.exp(-z));
      return clamp(logistic, 0, 1);
    }

    return clamp((qPreset - normRange.min) / span, 0, 1);
  })(); // 0=best, 1=worst

  // Map quality into a conservative band (avoid curve extremes), but allow
  // explicit large deltas (e.g. CQ20) to move closer to the best end.
  const { hi, lo } = (() => {
    let hiOut = 0.75;
    let loOut = 0.35;

    if (
      spec.domain === "qvbr" &&
      rc === "cq" &&
      hasExplicitQualityValue &&
      rec &&
      Number.isFinite(rec.target) &&
      Number.isFinite(qPreset)
    ) {
      const delta = rec.target - qPreset; // + = better
      if (delta >= 8) hiOut = 0.95;
      else if (delta >= 4) hiOut = 0.85;
      if (delta <= -8) loOut = 0.2;
      else if (delta <= -4) loOut = 0.28;
    }

    // Ensure a valid band.
    if (!(hiOut > loOut)) {
      hiOut = 0.75;
      loOut = 0.35;
    }
    return { hi: hiOut, lo: loOut };
  })();
  const pos = hi - (hi - lo) * t; // 0(best) => hi, 1(worst) => lo

  const minQ = axis[0]!;
  const maxQ = axis[axis.length - 1]!;
  const bestQ = spec.direction === "lower_is_better" ? minQ : maxQ;
  const worstQ = spec.direction === "lower_is_better" ? maxQ : minQ;
  const estimated = worstQ + (bestQ - worstQ) * pos;
  return clamp(estimated, minQ, maxQ);
};

const computeValueByCurveQuality = (
  dataset: VqDataset,
  spec: Pick<CurveQualitySpec, "axis" | "direction">,
  qCurve: number,
): { metricY: number; bitrateKbps: number } | null => {
  const sorted = dataset.points.slice().sort((a, b) => a.x - b.x);
  const deduped = (() => {
    if (sorted.length <= 1) return sorted;
    const out = [sorted[0]!];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = out[out.length - 1]!;
      const cur = sorted[i]!;
      if (cur.x === prev.x && cur.y === prev.y) continue;
      out.push(cur);
    }
    return out;
  })();

  const collapsed = (() => {
    if (deduped.length <= 1) return deduped;
    const out: { x: number; y: number }[] = [];
    let curX = deduped[0]!.x;
    let sum = deduped[0]!.y;
    let count = 1;
    for (let i = 1; i < deduped.length; i += 1) {
      const p = deduped[i]!;
      if (p.x === curX) {
        sum += p.y;
        count += 1;
        continue;
      }
      out.push({ x: curX, y: sum / count });
      curX = p.x;
      sum = p.y;
      count = 1;
    }
    out.push({ x: curX, y: sum / count });
    return out;
  })();

  const axis = sliceQualityAxisForPoints(spec, collapsed.length);
  if (axis.length !== collapsed.length || axis.length === 0) return null;

  const points = collapsed.slice().sort((a, b) => {
    // Preserve the original vq_results "quality sweep" direction:
    // - lower-is-better: bitrate decreases as axis increases => pair axis asc with bitrate desc
    // - higher-is-better: bitrate increases as axis increases => pair axis asc with bitrate asc
    return spec.direction === "lower_is_better" ? b.x - a.x : a.x - b.x;
  });

  const qualityToMetric = axis.map((q, i) => ({ x: q, y: points[i]!.y }));
  const qualityToBitrate = axis.map((q, i) => ({ x: q, y: points[i]!.x }));

  const metricY = interpolateY(qualityToMetric, qCurve);
  const bitrateKbps = interpolateY(qualityToBitrate, qCurve);
  if (!Number.isFinite(metricY) || !Number.isFinite(bitrateKbps)) return null;
  return { metricY, bitrateKbps };
};

export const computeMetricForDatasetKeyByQuality = (
  idx: Map<string, VqDataset>,
  metric: VqMetric,
  datasetKey: string,
  qCurve: number,
  spec: Pick<CurveQualitySpec, "axis" | "direction">,
): { metric: VqPredictedRange; bitrateKbps: VqPredictedRange } | null => {
  const allMetric: number[] = [];
  const allBitrate: number[] = [];

  for (const set of [1, 2] as const) {
    const d = idx.get(`${set}:${metric}:${datasetKey}`);
    if (!d) continue;
    const v = computeValueByCurveQuality(d, spec, qCurve);
    if (!v) continue;
    allMetric.push(v.metricY);
    allBitrate.push(v.bitrateKbps);
  }

  if (allMetric.length === 0 || allBitrate.length === 0) return null;

  const toPred = (values: number[]): VqPredictedRange => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    if (values.length >= 2) return { value, min: Math.min(...values), max: Math.max(...values) };
    return { value };
  };

  return { metric: toPred(allMetric), bitrateKbps: toPred(allBitrate) };
};

export const computeMetricWithVariantRangeByQuality = (
  idx: Map<string, VqDataset>,
  metric: VqMetric,
  primaryKey: string,
  variantKeys: string[],
  qCurve: number,
  spec: Pick<CurveQualitySpec, "axis" | "direction">,
): { metric: VqPredictedRange; bitrateKbps: VqPredictedRange } | null => {
  const primary = computeMetricForDatasetKeyByQuality(idx, metric, primaryKey, qCurve, spec);
  if (!primary) return null;

  let min = primary.metric.min ?? primary.metric.value;
  let max = primary.metric.max ?? primary.metric.value;

  for (const key of variantKeys) {
    if (!key || key === primaryKey) continue;
    const sibling = computeMetricForDatasetKeyByQuality(idx, metric, key, qCurve, spec);
    if (!sibling) continue;
    const sMin = sibling.metric.min ?? sibling.metric.value;
    const sMax = sibling.metric.max ?? sibling.metric.value;
    min = Math.min(min, sMin);
    max = Math.max(max, sMax);
  }

  const metricOut = min !== max ? { value: primary.metric.value, min, max } : { value: primary.metric.value };
  return { metric: metricOut, bitrateKbps: primary.bitrateKbps };
};
