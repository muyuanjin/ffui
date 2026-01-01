#!/usr/bin/env node
/**
 * Build a compact curve snapshot from rigaya/vq_results vq_results_data.js.
 *
 * - Downloads only vq_results homepage + vq_results_data.js (NO videos/logs).
 * - Parses curves into VqResultsSnapshot-shaped JSON.
 * - Optional point trimming for size; default keeps full curves to preserve behavior.
 */

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";

const HOMEPAGE_URL = "https://rigaya.github.io/vq_results/";
const DATA_URL = "https://rigaya.github.io/vq_results/results/vq_results_data.js";

const DEFAULT_TIMEOUT_MS = 25_000;

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-vq-results-snapshot.mjs --out <path>",
      "",
      "Options:",
      "  --out <path>        Output JSON path (must not already exist)",
      "  --pretty            Pretty-print JSON",
      "  --timeout-ms <ms>   Per-request timeout (default 25000)",
      "  --max-points <n>    Keep at most N points per curve (default keep all)",
      "  --round <decimals>  Round x/y values (default no rounding)",
      "",
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { outPath: "", pretty: false, timeoutMs: DEFAULT_TIMEOUT_MS, maxPoints: null, round: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--out") {
      out.outPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--pretty") {
      out.pretty = true;
      continue;
    }
    if (a === "--timeout-ms") {
      out.timeoutMs = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--max-points") {
      out.maxPoints = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--round") {
      out.round = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    }
  }
  if (!out.outPath) {
    usage();
    process.exit(2);
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) throw new Error(`invalid --timeout-ms: ${out.timeoutMs}`);
  if (out.maxPoints != null && (!Number.isFinite(out.maxPoints) || out.maxPoints < 2)) {
    throw new Error(`invalid --max-points: ${out.maxPoints}`);
  }
  if (out.round != null && (!Number.isFinite(out.round) || out.round < 0 || out.round > 6)) {
    throw new Error(`invalid --round: ${out.round}`);
  }
  return out;
};

const fetchWithTimeout = async (url, timeoutMs) => {
  const attempt = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  };

  let lastErr;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
};

const extractTitle = (html) => {
  const m = String(html ?? "").match(/<title>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
};

// Copied (with minimal adjustments) from src/lib/vqResults/parser.ts (TS → JS).
const DATASET_HEADER_RE = /^const\s+(data_(\d+)__bitrate_(ssim|vmaf|fps)_(\w+))\s*=\s*\{\s*$/m;
const LABEL_RE = /label:\s*"([^"]*)"/m;
const DATA_BLOCK_RE = /data:\s*\[([\s\S]*?)\]\s*,?\s*$/m;
const POINT_RE = /\{\s*x:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*y:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/g;

const sortByBitrateAsc = (points) => points.sort((a, b) => a.x - b.x);

const parseVqResultsDataJs = (source) => {
  const text = source ?? "";
  if (!text.trim()) return [];

  const parts = text.split(/\n(?=const data_\d+__bitrate_(?:ssim|vmaf|fps)_)/g);
  const out = [];

  for (const chunk of parts) {
    const header = chunk.match(DATASET_HEADER_RE);
    if (!header) continue;

    const set = Number(header[2]);
    const metric = header[3];
    const rawKey = header[4];
    const key = rawKey.startsWith("_") ? rawKey.slice(1) : rawKey;

    const endIdx = chunk.indexOf("\n};");
    if (endIdx < 0) continue;
    const objText = chunk.slice(0, endIdx);

    const label = objText.match(LABEL_RE)?.[1] ?? key;

    const dataMatch = objText.match(DATA_BLOCK_RE);
    if (!dataMatch) continue;

    const pointsText = dataMatch[1] ?? "";
    const points = [];
    for (const match of pointsText.matchAll(POINT_RE)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x, y });
    }
    if (points.length === 0) continue;
    sortByBitrateAsc(points);

    out.push({ set, metric, key, label, points });
  }

  return out;
};

const downsamplePoints = (points, maxPoints) => {
  if (!maxPoints || points.length <= maxPoints) return points;
  // Keep endpoints + evenly spaced picks.
  const out = [];
  const last = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const t = maxPoints === 1 ? 0 : i / (maxPoints - 1);
    const idx = Math.round(t * last);
    const p = points[idx];
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push(p);
  }
  return out;
};

const roundN = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const main = async () => {
  const { outPath, pretty, timeoutMs, maxPoints, round } = parseArgs();

  dns.setDefaultResultOrder("ipv4first");

  try {
    await fs.access(outPath);
    throw new Error(`refusing to overwrite existing file: ${outPath}`);
  } catch {
    // ok
  }

  const fetchedAtIso = new Date().toISOString();
  const [homeHtml, dataJs] = await Promise.all([
    fetchWithTimeout(HOMEPAGE_URL, timeoutMs),
    fetchWithTimeout(DATA_URL, timeoutMs),
  ]);
  const title = extractTitle(homeHtml);

  let datasets = parseVqResultsDataJs(dataJs);
  if (maxPoints != null) {
    datasets = datasets.map((d) => ({ ...d, points: downsamplePoints(d.points, maxPoints) }));
  }
  if (round != null) {
    datasets = datasets.map((d) => ({
      ...d,
      points: d.points.map((p) => ({ x: roundN(p.x, round), y: roundN(p.y, round) })),
    }));
  }

  const snapshot = {
    source: {
      homepageUrl: HOMEPAGE_URL,
      dataUrl: DATA_URL,
      title,
      fetchedAtIso,
    },
    datasets,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, pretty ? 2 : 0);
  await fs.writeFile(outPath, json, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`OK: wrote ${outPath}\n`);
  process.stdout.write(`datasets: ${datasets.length}\n`);
};

await main();
