import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FFmpegPreset } from "@/types";
import { predictFromVqResults } from "./predict";
import type { VqResultsSnapshot } from "./types";

type VmafAnchorFixture = {
  schemaVersion: number;
  reference: { name: string; sourceUrl: string; sha256: string; notes?: string[] };
  inputs: { snapshotPath: string; presetsPath: string; subset?: string };
  results: Array<{ presetId: string; encoder: string; vmafMean: number }>;
};

type SmartPresetsFile = { presets: FFmpegPreset[] };

const loadFixture = (p: string): VmafAnchorFixture => JSON.parse(readFileSync(p, "utf8")) as VmafAnchorFixture;

const loadSnapshot = (p: string): VqResultsSnapshot => JSON.parse(readFileSync(p, "utf8")) as VqResultsSnapshot;

const loadSmartPresets = (p: string): SmartPresetsFile => JSON.parse(readFileSync(p, "utf8")) as SmartPresetsFile;

const findPreset = (presets: FFmpegPreset[], presetId: string, encoder: string): FFmpegPreset => {
  const matches = presets.filter((p) => p.id === presetId && String(p.video?.encoder ?? "") === encoder);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`preset not found: id=${presetId} encoder=${encoder}`);
  throw new Error(`ambiguous preset match: id=${presetId} encoder=${encoder} count=${matches.length}`);
};

type Row = {
  id: string;
  name: string;
  encoder: string;
  measuredVmaf: number;
  predictedVmaf: number | null;
};

type ValidRow = Omit<Row, "predictedVmaf"> & { predictedVmaf: number };

const isValidRow = (r: Row): r is ValidRow =>
  r.encoder.length > 0 && Number.isFinite(r.measuredVmaf) && typeof r.predictedVmaf === "number";

describe("vq_results predictor vs measured VMAF anchor", () => {
  it("keeps ranking direction consistent with measured anchors for obvious deltas", () => {
    const overridePath = String(process.env.FFUI_VMAF_ANCHOR_PATH ?? "").trim();
    const fixturePath = overridePath
      ? overridePath
      : resolve(process.cwd(), "src/lib/vqResults/__fixtures__/vmafAnchor.bbb1080p30s.defaultSelected.json");

    const anchor = loadFixture(fixturePath);
    expect(anchor.schemaVersion).toBe(1);
    expect(Array.isArray(anchor.results)).toBe(true);

    const snapshotPath = resolve(process.cwd(), anchor.inputs.snapshotPath);
    const snapshot = loadSnapshot(snapshotPath);

    const presetsPath = resolve(process.cwd(), anchor.inputs.presetsPath);
    const presets = loadSmartPresets(presetsPath).presets ?? [];

    const rows = anchor.results
      .map<Row>((r) => {
        const preset = findPreset(presets, r.presetId, r.encoder);
        const predicted = predictFromVqResults(snapshot, preset);
        const predictedVmaf = predicted?.vmaf?.value ?? null;
        return {
          id: `${r.presetId}__${r.encoder}`,
          name: preset.name,
          encoder: String(preset?.video?.encoder ?? ""),
          measuredVmaf: Number(r.vmafMean),
          predictedVmaf,
        };
      })
      .filter(isValidRow);

    // Nothing to check.
    if (rows.length < 2) return;

    // Pairwise check: if measured differs by a meaningful margin, prediction must
    // not reverse the ordering. This is intentionally a *coarse* gate to avoid
    // hard-coding per-video absolute targets (which can break generalization).
    const minDelta = 1.0;
    const epsilon = 0.15;

    const failures: Array<{
      a: { id: string; measured: number; predicted: number };
      b: { id: string; measured: number; predicted: number };
    }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i]!;
        const b = rows[j]!;
        // Keep the gate focused on predictor correctness within the same
        // encoder family. Cross-encoder comparisons require bitrate/size
        // normalization and are intentionally out of scope for this anchor.
        if (a.encoder !== b.encoder) continue;
        const dm = a.measuredVmaf - b.measuredVmaf;
        if (Math.abs(dm) < minDelta) continue;
        const dp = a.predictedVmaf - b.predictedVmaf;
        if (dm > 0 && dp < -epsilon) {
          failures.push({
            a: { id: a.id, measured: a.measuredVmaf, predicted: a.predictedVmaf },
            b: { id: b.id, measured: b.measuredVmaf, predicted: b.predictedVmaf },
          });
        } else if (dm < 0 && dp > epsilon) {
          failures.push({
            a: { id: a.id, measured: a.measuredVmaf, predicted: a.predictedVmaf },
            b: { id: b.id, measured: b.measuredVmaf, predicted: b.predictedVmaf },
          });
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
