import type { VqDataset, VqMetric, VqPoint } from "./types";
import { collapseSameXPointsByAverage } from "./interpolation";

// vq_results uses two naming variants:
// - data_1__bitrate_vmaf__x264_medium_crf  (extra '_' before key)
// - data_1__bitrate_vmaf_rtx4080_NVEncC_HEVC_quality
// Normalize by always matching a single '_' after metric and stripping a
// leading '_' from the extracted key when present.
const DATASET_HEADER_RE = /^const\s+(data_(\d+)__bitrate_(ssim|vmaf|fps)_(\w+))\s*=\s*\{\s*$/m;

const LABEL_RE = /label:\s*"([^"]*)"/m;

const DATA_BLOCK_RE = /data:\s*\[([\s\S]*?)\]\s*,?\s*$/m;

const POINT_RE = /\{\s*x:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*y:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/g;

const sortByBitrateAsc = (points: VqPoint[]) => points.sort((a, b) => a.x - b.x);

const dedupeConsecutivePoints = (points: VqPoint[]): VqPoint[] => {
  if (points.length <= 1) return points;
  const out: VqPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    if (cur.x === prev.x && cur.y === prev.y) continue;
    out.push(cur);
  }
  return out;
};

export const parseVqResultsDataJs = (source: string): VqDataset[] => {
  const text = source ?? "";
  if (!text.trim()) return [];

  // Split by dataset declarations to keep parsing linear-time and avoid
  // catastrophic regex backtracking on a large file.
  const parts = text.split(/\n(?=const data_\d+__bitrate_(?:ssim|vmaf|fps)_)/g);
  const out: VqDataset[] = [];

  for (const chunk of parts) {
    const header = chunk.match(DATASET_HEADER_RE);
    if (!header) continue;

    const set = Number(header[2]);
    const metric = header[3] as VqMetric;
    const rawKey = header[4];
    const key = rawKey.startsWith("_") ? rawKey.slice(1) : rawKey;

    // Heuristic: end of the object is the first line that is just "};".
    const endIdx = chunk.indexOf("\n};");
    if (endIdx < 0) continue;
    const objText = chunk.slice(0, endIdx);

    const label = objText.match(LABEL_RE)?.[1] ?? key;

    const dataMatch = objText.match(DATA_BLOCK_RE);
    if (!dataMatch) continue;

    const pointsText = dataMatch[1] ?? "";
    const points: VqPoint[] = [];
    for (const match of pointsText.matchAll(POINT_RE)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x, y });
    }

    if (points.length === 0) continue;
    sortByBitrateAsc(points);
    const deduped = collapseSameXPointsByAverage(dedupeConsecutivePoints(points));

    out.push({ set, metric, key, label, points: deduped });
  }

  return out;
};
