import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { VqDataset, VqResultsSnapshot } from "./types";
import { collapseSameXPoints } from "./points";
import { computeMetricForDatasetKeyByQuality, getCurveQualitySpec, getQualityAxisForPointsCount } from "./curveQuality";

const loadSnapshot = (): VqResultsSnapshot =>
  JSON.parse(readFileSync(resolve(process.cwd(), "public/vq/quality_snapshot.json"), "utf8")) as VqResultsSnapshot;

describe("quality_snapshot self-consistency", () => {
  it("reproduces vmaf curve points via the quality-axis sampler for all supported dataset keys", () => {
    const snapshot = loadSnapshot();
    expect(snapshot.datasets.length).toBeGreaterThan(1000);

    const supported = snapshot.datasets.filter((d) => d.metric === "vmaf" && getCurveQualitySpec(d.key));
    expect(supported.length).toBeGreaterThan(100);

    let checks = 0;
    const failures: Array<{ set: number; key: string; metric: string; q: number; expected: number; got: number }> = [];

    for (const dataset of supported) {
      const spec = getCurveQualitySpec(dataset.key);
      if (!spec) continue;

      const pointsAsc = dataset.points.slice().sort((a, b) => a.x - b.x);
      const collapsed = collapseSameXPoints(pointsAsc);
      if (collapsed.length < 2) continue;

      const axis = getQualityAxisForPointsCount(spec, collapsed.length);
      if (axis.length !== collapsed.length) continue;

      const expectedPoints =
        spec.direction === "lower_is_better" ? collapsed.slice().sort((a, b) => b.x - a.x) : collapsed;

      const idx = new Map<string, VqDataset>();
      idx.set(`${dataset.set}:${dataset.metric}:${dataset.key}`, { ...dataset, points: pointsAsc });

      for (let i = 0; i < axis.length; i += 1) {
        const q = axis[i]!;
        const expected = expectedPoints[i]!.y;
        const out = computeMetricForDatasetKeyByQuality(idx, dataset.metric, dataset.key, q, spec);
        const got = out?.metric?.value ?? NaN;
        checks += 1;
        if (!Number.isFinite(got) || Math.abs(got - expected) > 1e-6) {
          failures.push({ set: dataset.set, key: dataset.key, metric: dataset.metric, q, expected, got });
          if (failures.length >= 20) break;
        }
      }
      if (failures.length >= 20) break;
    }

    expect(checks).toBeGreaterThan(1000);
    expect(failures).toEqual([]);
  });
});
