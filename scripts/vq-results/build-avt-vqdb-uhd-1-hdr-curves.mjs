#!/usr/bin/env node
/**
 * Build compact bitrate→quality curves from AVT-VQDB-UHD-1-HDR VMAF JSON reports.
 *
 * - Downloads only objective metric JSON reports (NO videos).
 * - Aggregates per (codec, resolution, content) and produces monotonic curves.
 * - Emits VqResultsSnapshot-compatible JSON so it can be merged with vq_results data later.
 */

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 60_000;

const AVT_HDR_BASE = "https://avtshare01.rz.tu-ilmenau.de/avt-vqdb-uhd-1-hdr/";
const VMAF_DIR = new URL("objective_scores/vmaf_scores/", AVT_HDR_BASE).toString();

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-avt-vqdb-uhd-1-hdr-curves.mjs --out <path>",
      "",
      "Options:",
      "  --out <path>       Output JSON path (must not already exist)",
      "  --pretty           Pretty-print JSON",
      "  --timeout-ms <ms>  Per-request timeout (default 60000)",
      "",
    ].join("\n") + "\n",
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { outPath: "", pretty: false, timeoutMs: DEFAULT_TIMEOUT_MS };
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
    if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    }
  }
  if (!out.outPath) {
    usage();
    process.exit(2);
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) {
    throw new Error(`invalid --timeout-ms: ${out.timeoutMs}`);
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

const parseListingJsonFiles = (html) => {
  const out = [];
  const re = /<a href="\.\/([^"]+\.json)"/g;
  for (;;) {
    const m = re.exec(String(html ?? ""));
    if (!m) break;
    out.push(String(m[1]));
  }
  return out;
};

const parseFileName = (file) => {
  // Example: 1280_720_500K_av1_Center_Panorama.json
  const raw = String(file ?? "");
  const m = raw.match(/^(\d+)_([\d]+)_([0-9]+)K_([a-z0-9]+)_(.+)\.json$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  const bitrateKbps = Number(m[3]);
  const codec = String(m[4]).toLowerCase();
  const content = String(m[5]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(bitrateKbps)) return null;
  if (width <= 0 || height <= 0 || bitrateKbps <= 0) return null;
  return { width, height, bitrateKbps, codec, content };
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (n) => Math.round(n * 1000) / 1000;

const mean = (values) => {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count ? sum / count : NaN;
};

const enforceMonotone = (points) => {
  // points sorted by x; each has {x, y, w} where w is sample count
  const blocks = [];
  for (const p of points) {
    blocks.push({ w: p.w, y: p.y, xs: [p.x] });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.y <= b.y) break;
      const w = a.w + b.w;
      const y = (a.y * a.w + b.y * b.w) / w;
      blocks.splice(blocks.length - 2, 2, { w, y, xs: [...a.xs, ...b.xs] });
    }
  }
  const yByX = new Map();
  for (const b of blocks) for (const x of b.xs) yByX.set(x, b.y);
  return points.map((p) => ({ x: p.x, y: yByX.get(p.x) ?? p.y }));
};

const slugify = (s) =>
  String(s ?? "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 48) || "unknown";

const sha1_8 = (s) =>
  crypto
    .createHash("sha1")
    .update(String(s ?? ""), "utf8")
    .digest("hex")
    .slice(0, 8);

const runPool = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
};

const main = async () => {
  const { outPath, pretty, timeoutMs } = parseArgs();

  // Prefer IPv4 to avoid IPv6-only connect timeouts on some hosts.
  dns.setDefaultResultOrder("ipv4first");

  try {
    await fs.access(outPath);
    throw new Error(`refusing to overwrite existing file: ${outPath}`);
  } catch {
    // ok
  }

  const fetchedAtIso = new Date().toISOString();

  const listingHtml = await fetchWithTimeout(VMAF_DIR, timeoutMs);
  const files = parseListingJsonFiles(listingHtml);
  if (files.length === 0) throw new Error(`no .json files discovered in listing: ${VMAF_DIR}`);

  const parsedFiles = files.map((f) => ({ file: f, meta: parseFileName(f) })).filter((x) => x.meta);
  if (parsedFiles.length === 0) throw new Error("no parsable vmaf report filenames found");

  const groups = new Map();
  const getGroup = (key, meta) => {
    const g = groups.get(key);
    if (g) return g;
    const created = {
      meta,
      metrics: {
        vmaf: new Map(),
        ssim: new Map(),
      },
    };
    groups.set(key, created);
    return created;
  };

  const computeMeanMetrics = (jsonText) => {
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`JSON parse failed: ${String(e)}`);
    }
    const frames = Array.isArray(json?.frames) ? json.frames : [];
    const vmafs = [];
    const ssims = [];
    for (const f of frames) {
      const metrics = f?.metrics;
      const vmaf = Number(metrics?.vmaf);
      const ssim = Number(metrics?.float_ssim);
      if (Number.isFinite(vmaf)) vmafs.push(vmaf);
      if (Number.isFinite(ssim)) ssims.push(ssim);
    }
    return { vmaf: mean(vmafs), ssim: mean(ssims) };
  };

  await runPool(parsedFiles, 8, async ({ file, meta }) => {
    const url = new URL(`objective_scores/vmaf_scores/${file}`, AVT_HDR_BASE).toString();
    const raw = await fetchWithTimeout(url, timeoutMs);
    const metrics = computeMeanMetrics(raw);

    const groupKey = `${meta.codec}|${meta.width}x${meta.height}|${meta.content}`;
    const groupMeta = { codec: meta.codec, width: meta.width, height: meta.height, content: meta.content };
    const g = getGroup(groupKey, groupMeta);

    if (Number.isFinite(metrics.vmaf)) {
      const arr = g.metrics.vmaf.get(meta.bitrateKbps);
      if (arr) arr.push(metrics.vmaf);
      else g.metrics.vmaf.set(meta.bitrateKbps, [metrics.vmaf]);
    }
    if (Number.isFinite(metrics.ssim)) {
      const arr = g.metrics.ssim.get(meta.bitrateKbps);
      if (arr) arr.push(metrics.ssim);
      else g.metrics.ssim.set(meta.bitrateKbps, [metrics.ssim]);
    }
    return null;
  });

  const datasets = [];
  const addDataset = (set, metric, key, label, points) => datasets.push({ set, metric, key, label, points });

  for (const { meta, metrics } of groups.values()) {
    const contentSlug = slugify(meta.content);
    const contentHash = sha1_8(meta.content);
    const baseKey = `avt_hdr_${meta.codec}_${meta.width}x${meta.height}_${contentSlug}_${contentHash}`;

    for (const metric of ["vmaf", "ssim"]) {
      const byBitrate = metrics[metric];
      const perBitrate = [...byBitrate.entries()].map(([bitrateKbps, values]) => {
        const avg = mean(values);
        return { x: bitrateKbps, y: avg, w: values.length };
      });
      perBitrate.sort((a, b) => a.x - b.x);
      if (perBitrate.length < 2) continue;

      const monotone = enforceMonotone(perBitrate);

      const clampY = (v) => {
        if (metric === "vmaf") return clamp(v, 0, 100);
        return clamp(v, 0, 1);
      };

      const points = monotone.map((p) => ({ x: p.x, y: round3(clampY(p.y)) }));

      const key = baseKey;
      const label = `AVT-VQDB-UHD-1-HDR ${meta.codec} ${meta.width}x${meta.height} ${meta.content} (mean)`;
      addDataset(1, metric, key, label, points);
      addDataset(2, metric, key, label, points);
    }
  }

  const snapshot = {
    source: {
      homepageUrl: "https://github.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-HDR",
      dataUrl: AVT_HDR_BASE,
      title: "AVT-VQDB-UHD-1-HDR (derived curves)",
      fetchedAtIso,
    },
    datasets,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, pretty ? 2 : 0);
  await fs.writeFile(outPath, json, { encoding: "utf8", flag: "wx" });

  process.stdout.write(
    [
      `OK: wrote ${outPath}`,
      `reports: ${parsedFiles.length}`,
      `datasets: ${datasets.length} (unique keys=${new Set(datasets.map((d) => d.key)).size})`,
    ].join("\n") + "\n",
  );
};

await main();
