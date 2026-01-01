#!/usr/bin/env node
/**
 * Merge multiple VqResultsSnapshot JSON files into a single snapshot.
 *
 * Merge policy:
 * - Datasets are keyed by `${set}:${metric}:${key}`.
 * - First occurrence wins; later duplicates are dropped (reported).
 * - Source metadata is preserved in `sources` (optional field).
 */

import fs from "node:fs/promises";
import path from "node:path";

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/merge-quality-snapshots.mjs --out <path> --in <snap1.json> --in <snap2.json> ...",
      "",
      "Options:",
      "  --out <path>     Output JSON path (must not already exist)",
      "  --in <path>      Input snapshot JSON path (repeatable)",
      "  --pretty         Pretty-print JSON",
      "",
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { outPath: "", inputs: [], pretty: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--out") {
      out.outPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--in") {
      out.inputs.push(String(args[i + 1] ?? ""));
      i += 1;
      continue;
    }
    if (a === "--pretty") {
      out.pretty = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    }
  }
  if (!out.outPath || out.inputs.length === 0) {
    usage();
    process.exit(2);
  }
  return out;
};

const readJson = async (p) => {
  const text = await fs.readFile(p, "utf8");
  return JSON.parse(text);
};

const main = async () => {
  const { outPath, inputs, pretty } = parseArgs();

  try {
    await fs.access(outPath);
    throw new Error(`refusing to overwrite existing file: ${outPath}`);
  } catch {
    // ok
  }

  const snapshots = [];
  for (const input of inputs) {
    const s = await readJson(input);
    if (!s || !Array.isArray(s.datasets)) throw new Error(`invalid snapshot: ${input}`);
    snapshots.push({ path: input, snapshot: s });
  }

  const sources = snapshots.map(({ path: p, snapshot }) => ({
    id: path.basename(p),
    path: p,
    ...snapshot.source,
  }));

  const datasets = [];
  const seen = new Set();
  const duplicates = [];

  for (const { path: p, snapshot } of snapshots) {
    for (const d of snapshot.datasets) {
      const set = Number(d?.set);
      const metric = String(d?.metric ?? "");
      const key = String(d?.key ?? "");
      if (!Number.isFinite(set) || (metric !== "vmaf" && metric !== "ssim" && metric !== "fps") || !key) continue;
      const id = `${set}:${metric}:${key}`;
      if (seen.has(id)) {
        duplicates.push({ id, from: p });
        continue;
      }
      seen.add(id);
      datasets.push(d);
    }
  }

  const snapshot = {
    source: {
      homepageUrl: "ffui://local/unified",
      dataUrl: "ffui://local/unified",
      title: "ffui unified video-quality snapshot",
      fetchedAtIso: new Date().toISOString(),
    },
    sources,
    datasets,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, pretty ? 2 : 0);
  await fs.writeFile(outPath, json, { encoding: "utf8", flag: "wx" });

  process.stdout.write(`OK: wrote ${outPath}\n`);
  process.stdout.write(`inputs: ${inputs.length}\n`);
  process.stdout.write(`datasets: ${datasets.length}\n`);
  process.stdout.write(`duplicates_dropped: ${duplicates.length}\n`);
};

await main();
