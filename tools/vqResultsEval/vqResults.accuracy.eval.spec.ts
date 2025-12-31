import { describe, expect, it } from "vitest";

import type { FFmpegPreset } from "@/types";
import { parseVqResultsDataJs } from "@/lib/vqResults/parser";
import { predictFromVqResults } from "@/lib/vqResults/predict";
import type { VqResultsSnapshot } from "@/lib/vqResults/types";

type LogRow = {
  encoder: string;
  presetLabel: string;
  quality: number;
  bitrateKbps: number;
  ssim: number;
  vmaf: number;
  fps: number;
};

const BITRATE_MAX_CUT_KBPS = 8000;

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
  return await res.text();
};

const median = (values: number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const parseLogRows = (raw: string): LogRow[] => {
  const out: LogRow[] = [];
  for (const line of String(raw ?? "").split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(",").map((c) => c.trim());
    if (cols.length < 11) continue;
    const encoder = cols[0] ?? "";
    const presetLabel = cols[1] ?? "";
    const quality = Number(cols[2]);
    const bitrateKbps = Number(cols[3]);
    const ssim = Number(cols[5]);
    const vmaf = Number(cols[7]);
    const fps = Number(cols[10]);
    if (!encoder || !presetLabel) continue;
    if (![quality, bitrateKbps, ssim, vmaf, fps].every(Number.isFinite)) continue;
    out.push({ encoder, presetLabel, quality, bitrateKbps, ssim, vmaf, fps });
  }
  return out;
};

const selectTruth = (
  rows: LogRow[],
  encoder: string,
  presetLabel: string,
): Map<number, Omit<LogRow, "encoder" | "presetLabel">> => {
  const out = new Map<number, Omit<LogRow, "encoder" | "presetLabel">>();
  for (const r of rows) {
    if (r.encoder !== encoder) continue;
    if (r.presetLabel !== presetLabel) continue;
    if (r.bitrateKbps > BITRATE_MAX_CUT_KBPS) continue;
    out.set(r.quality, { quality: r.quality, bitrateKbps: r.bitrateKbps, ssim: r.ssim, vmaf: r.vmaf, fps: r.fps });
  }
  return out;
};

const aggregateSets = (
  set1: Map<number, Omit<LogRow, "encoder" | "presetLabel">>,
  set2: Map<number, Omit<LogRow, "encoder" | "presetLabel">>,
): Map<
  number,
  {
    bitrateKbps: { value: number; min?: number; max?: number };
    vmaf: { value: number; min?: number; max?: number };
    ssim: { value: number; min?: number; max?: number };
    fps: { value: number; min?: number; max?: number };
  }
> => {
  // Evaluate only the intersection so we validate exact matches (no clamping).
  const qualities = new Set<number>([...set1.keys()].filter((q) => set2.has(q)));
  const out = new Map<number, any>();

  const mk = (a?: number, b?: number) => {
    const values = [a, b].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length === 0) return null;
    if (values.length === 1) return { value: values[0]! };
    return { value: median(values), min: Math.min(...values), max: Math.max(...values) };
  };

  for (const q of [...qualities].sort((a, b) => a - b)) {
    const a = set1.get(q);
    const b = set2.get(q);
    const bitrateKbps = mk(a?.bitrateKbps, b?.bitrateKbps);
    const vmaf = mk(a?.vmaf, b?.vmaf);
    const ssim = mk(a?.ssim, b?.ssim);
    const fps = mk(a?.fps, b?.fps);
    if (!bitrateKbps || !vmaf || !ssim || !fps) continue;
    out.set(q, { bitrateKbps, vmaf, ssim, fps });
  }
  return out;
};

describe("vq_results accuracy eval (manual)", () => {
  it("matches upstream logs on CRF-driven datasets after bitrate cap", async () => {
    const dataJs = await fetchText("https://rigaya.github.io/vq_results/results/vq_results_data.js");
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://rigaya.github.io/vq_results/",
        dataUrl: "https://rigaya.github.io/vq_results/results/vq_results_data.js",
        title: null,
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: parseVqResultsDataJs(dataJs),
    };

    const cases: Array<{
      datasetKey: string;
      encoder: string;
      preset: string;
      setLabel: string;
      log1: string;
      log2: string;
    }> = [
      {
        datasetKey: "x264_medium_crf",
        encoder: "libx264",
        preset: "medium",
        setLabel: "medium crf",
        log1: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim1_log_RIGAYA9-PC_x264.txt",
        log2: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim2_log_RIGAYA9-PC_x264.txt",
      },
      {
        datasetKey: "x265_medium_crf",
        encoder: "libx265",
        preset: "medium",
        setLabel: "medium crf",
        log1: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim1_log_RIGAYA9-PC_x265.txt",
        log2: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim2_log_RIGAYA9-PC_x265.txt",
      },
      {
        datasetKey: "svtav1_8bit_preset_7",
        encoder: "libsvtav1",
        preset: "7",
        setLabel: "8bit_preset_7",
        log1: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim1_log_RIGAYA7-PC_svtav1.txt",
        log2: "https://raw.githubusercontent.com/rigaya/vq_results/master/results/ssim2_log_RIGAYA7-PC_svtav1.txt",
      },
    ];

    const logTexts = await Promise.all([...new Set(cases.flatMap((c) => [c.log1, c.log2]))].map(fetchText));
    const logsByUrl = new Map<string, string>(
      [...new Set(cases.flatMap((c) => [c.log1, c.log2]))].map((u, i) => [u, logTexts[i]!] as const),
    );

    for (const c of cases) {
      const rows1 = parseLogRows(logsByUrl.get(c.log1)!);
      const rows2 = parseLogRows(logsByUrl.get(c.log2)!);
      const truth1 = selectTruth(
        rows1,
        c.encoder === "libsvtav1" ? "svtav1" : c.encoder === "libx264" ? "x264" : "x265",
        c.setLabel,
      );
      const truth2 = selectTruth(
        rows2,
        c.encoder === "libsvtav1" ? "svtav1" : c.encoder === "libx264" ? "x264" : "x265",
        c.setLabel,
      );
      const truth = aggregateSets(truth1, truth2);

      const errors: { vmaf: number; ssim: number; fps: number; bitrate: number }[] = [];

      for (const [q, t] of truth) {
        const preset: FFmpegPreset = {
          id: "eval",
          name: "eval",
          description: "",
          video: { encoder: c.encoder as any, rateControl: "crf" as any, qualityValue: q, preset: c.preset },
          audio: { codec: "copy" as any },
          filters: {},
          stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
        };

        const predicted = predictFromVqResults(snapshot, preset, { datasetKeyOverride: c.datasetKey });
        expect(predicted, `${c.datasetKey} q=${q} should be predictable`).toBeTruthy();

        const vmaf = predicted!.vmaf!;
        const ssim = predicted!.ssim!;
        const fps = predicted!.fps!;

        // Median across set=1/2 should match.
        expect(vmaf.value).toBeCloseTo(t.vmaf.value, 6);
        expect(ssim.value).toBeCloseTo(t.ssim.value, 6);
        expect(fps.value).toBeCloseTo(t.fps.value, 6);
        expect(predicted!.bitrateKbps).toBeCloseTo(t.bitrateKbps.value, 6);

        // When both sets exist, min/max should match as well.
        if (t.vmaf.min != null && t.vmaf.max != null) {
          expect(vmaf.min).toBeCloseTo(t.vmaf.min, 6);
          expect(vmaf.max).toBeCloseTo(t.vmaf.max, 6);
        }
        if (t.ssim.min != null && t.ssim.max != null) {
          expect(ssim.min).toBeCloseTo(t.ssim.min, 6);
          expect(ssim.max).toBeCloseTo(t.ssim.max, 6);
        }
        if (t.fps.min != null && t.fps.max != null) {
          expect(fps.min).toBeCloseTo(t.fps.min, 6);
          expect(fps.max).toBeCloseTo(t.fps.max, 6);
        }

        errors.push({
          vmaf: Math.abs(vmaf.value - t.vmaf.value),
          ssim: Math.abs(ssim.value - t.ssim.value),
          fps: Math.abs(fps.value - t.fps.value),
          bitrate: Math.abs(predicted!.bitrateKbps - t.bitrateKbps.value),
        });
      }

      const mae = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      const max = (arr: number[]) => Math.max(...arr);
      const vmafMae = mae(errors.map((e) => e.vmaf));
      const ssimMae = mae(errors.map((e) => e.ssim));
      const fpsMae = mae(errors.map((e) => e.fps));
      const bitrateMae = mae(errors.map((e) => e.bitrate));
      // eslint-disable-next-line no-console
      console.log(
        `[vq_results eval] ${c.datasetKey}: points=${errors.length} MAE(vmaf=${vmafMae}, ssim=${ssimMae}, fps=${fpsMae}, bitrate=${bitrateMae}) max(vmaf=${max(
          errors.map((e) => e.vmaf),
        )})`,
      );
    }
  }, 120_000);
});
