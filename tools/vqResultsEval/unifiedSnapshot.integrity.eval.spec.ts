import { describe, expect, it } from "vitest";
import { parseVqResultsDataJs } from "@/lib/vqResults/parser";
import type { VqResultsSnapshot } from "@/lib/vqResults/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
};

const datasetId = (d: { set: number; metric: string; key: string }) => `${d.set}:${d.metric}:${d.key}`;

describe("unified vq snapshot integrity (manual)", () => {
  it("keeps vq_results datasets byte-for-byte identical after snapshot build+merge", async () => {
    const dataJs = await fetchText("https://rigaya.github.io/vq_results/results/vq_results_data.js");
    const baseline: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://rigaya.github.io/vq_results/",
        dataUrl: "(inline)",
        title: null,
        fetchedAtIso: "",
      },
      datasets: parseVqResultsDataJs(dataJs),
    };

    const stamp = `${Date.now()}-${process.pid}`;
    const outDir = path.join(".cache", "vq-results-datasets", "eval", stamp);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, "unified.snapshot.json");

    await execFileAsync("node", [path.join("scripts", "vq-results", "build-quality-snapshot.mjs"), "--out", outPath]);
    const unifiedRaw = await fs.readFile(outPath, "utf8");
    const unified = JSON.parse(unifiedRaw) as VqResultsSnapshot;

    const unifiedIndex = new Map<string, unknown>();
    for (const d of unified.datasets) unifiedIndex.set(datasetId(d), d);

    for (const d of baseline.datasets) {
      const id = datasetId(d);
      const candidate = unifiedIndex.get(id);
      expect(candidate, `missing dataset ${id}`).toBeTruthy();
      expect(candidate).toEqual(d);
    }
  }, 600_000);
});
