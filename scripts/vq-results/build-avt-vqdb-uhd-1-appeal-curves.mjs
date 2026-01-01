#!/usr/bin/env node
/**
 * Build compact bitrate→quality curves from AVT-VQDB-UHD-1-Appeal VMAF JSON reports.
 *
 * - Downloads only VMAF JSON reports from GitHub (NO videos).
 * - Derives bitrate→(mean vmaf / mean ssim) curves per (codec, resolution, content).
 * - Emits VqResultsSnapshot-compatible JSON so it can be merged with vq_results data later.
 */

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 60_000;

const REPO = "Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-Appeal";
const ZIP_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/`;

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-avt-vqdb-uhd-1-appeal-curves.mjs --out <path>",
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

const fetchBufferWithTimeout = async (url, timeoutMs) => {
  const attempt = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
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

const fetchTextWithTimeout = async (url, timeoutMs) => {
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

const readU16 = (buf, off) => buf.readUInt16LE(off);
const readU32 = (buf, off) => buf.readUInt32LE(off);

const listZipFileNames = (zipBuf) => {
  // Minimal ZIP central directory parser (no decompression needed).
  // EOCD signature: 0x06054b50, central file header: 0x02014b50.
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;

  const maxComment = 0xffff;
  const searchStart = Math.max(0, zipBuf.length - (22 + maxComment));
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= searchStart; i -= 1) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip EOCD not found");

  const cdSize = readU32(zipBuf, eocd + 12);
  const cdOffset = readU32(zipBuf, eocd + 16);
  const cdEnd = cdOffset + cdSize;
  if (cdOffset <= 0 || cdEnd > zipBuf.length) throw new Error("zip central directory bounds invalid");

  const names = [];
  let p = cdOffset;
  while (p + 46 <= cdEnd) {
    const sig = readU32(zipBuf, p);
    if (sig !== CEN_SIG) break;
    const nameLen = readU16(zipBuf, p + 28);
    const extraLen = readU16(zipBuf, p + 30);
    const commentLen = readU16(zipBuf, p + 32);
    const nameOff = p + 46;
    const nameEnd = nameOff + nameLen;
    const extraEnd = nameEnd + extraLen;
    const next = extraEnd + commentLen;
    if (nameEnd > cdEnd || next > cdEnd) break;
    const name = zipBuf.slice(nameOff, nameEnd).toString("utf8");
    names.push(name);
    p = next;
  }
  return names;
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

const heightToWidth16by9 = (h) => {
  const w = Math.round((Number(h) * 16) / 9);
  if (!Number.isFinite(w) || w <= 0) return null;
  return w;
};

const parseVmafScoreFileName = (fileBase) => {
  // Examples:
  // - BunnyAnimation_1000k_1080_av1.json
  // - BunnyAnimation_1080p_1000k.266.json  (VVC)
  const raw = String(fileBase ?? "");

  const m1 = raw.match(/^(.+)_([0-9]+)k_([0-9]+)_([a-z0-9]+)\.json$/i);
  if (m1) {
    const content = String(m1[1]);
    const bitrateKbps = Number(m1[2]);
    const height = Number(m1[3]);
    const codec = String(m1[4]).toLowerCase();
    const width = heightToWidth16by9(height);
    if (!width) return null;
    return { content, bitrateKbps, width, height, codec };
  }

  const m2 = raw.match(/^(.+)_([0-9]+)p_([0-9]+)k\.([0-9]+)\.json$/i);
  if (m2) {
    const content = String(m2[1]);
    const height = Number(m2[2]);
    const bitrateKbps = Number(m2[3]);
    const ext = String(m2[4]);
    const codec = ext === "266" ? "vvc" : `codec_${ext}`;
    const width = heightToWidth16by9(height);
    if (!width) return null;
    return { content, bitrateKbps, width, height, codec };
  }

  return null;
};

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
    const ssim = Number(metrics?.ssim);
    if (Number.isFinite(vmaf)) vmafs.push(vmaf);
    if (Number.isFinite(ssim)) ssims.push(ssim);
  }
  return { vmaf: mean(vmafs), ssim: mean(ssims) };
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

  const zipBuf = await fetchBufferWithTimeout(ZIP_URL, timeoutMs);
  const names = listZipFileNames(zipBuf);

  const prefix = "AVT-VQDB-UHD-1-Appeal-main/vmaf_scores/";
  const vmafFiles = names.filter((n) => n.startsWith(prefix) && n.endsWith(".json")).map((n) => n.slice(prefix.length));
  if (vmafFiles.length === 0) throw new Error("no vmaf_scores/*.json entries found in repo zip");

  const parsed = vmafFiles
    .map((f) => ({ file: f, meta: parseVmafScoreFileName(f) }))
    .filter((x) => x.meta && String(x.meta.codec).startsWith("codec_") === false);

  if (parsed.length === 0) throw new Error("no parsable vmaf_scores filenames found");

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

  await runPool(parsed, 8, async ({ file, meta }) => {
    const url = new URL(`vmaf_scores/${file}`, RAW_BASE).toString();
    const raw = await fetchTextWithTimeout(url, timeoutMs);
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
    const keyBase = `avt_appeal_${meta.codec}_${meta.width}x${meta.height}_${contentSlug}_${contentHash}`;
    const labelBase = `AVT-VQDB-UHD-1-Appeal ${meta.codec} ${meta.width}x${meta.height} ${meta.content} (mean)`;

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
      addDataset(1, metric, keyBase, labelBase, points);
      addDataset(2, metric, keyBase, labelBase, points);
    }
  }

  const snapshot = {
    source: {
      homepageUrl: `https://github.com/${REPO}`,
      dataUrl: RAW_BASE,
      title: "AVT-VQDB-UHD-1-Appeal (derived curves)",
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
      `zipBytes: ${zipBuf.length}`,
      `reports: ${parsed.length} (raw files in repo: ${vmafFiles.length})`,
      `datasets: ${datasets.length} (unique keys=${new Set(datasets.map((d) => d.key)).size})`,
    ].join("\n") + "\n",
  );
};

await main();
