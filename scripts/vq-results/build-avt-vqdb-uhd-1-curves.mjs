#!/usr/bin/env node
/**
 * Build compact bitrate→quality curves from AVT-VQDB-UHD-1 test result CSVs.
 *
 * - Downloads only CSV metadata/objective scores/MOS (NO videos).
 * - Aggregates per (codec, resolution, frame_rate) and produces monotonic curves.
 * - Emits VqResultsSnapshot-compatible JSON so it can be merged with vq_results data later.
 */

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 25_000;

const AVT_REPO_RAW_BASE =
  "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1/master";

const TEST_IDS = [1, 2, 3, 4];

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-avt-vqdb-uhd-1-curves.mjs --out <path>",
      "",
      "Options:",
      "  --out <path>       Output JSON path (must not already exist)",
      "  --pretty           Pretty-print JSON",
      "  --timeout-ms <ms>  Per-request timeout (default 25000)",
      "",
    ].join("\n"),
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
      // small backoff for transient DNS/connectivity issues
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
};

const parseCsv = (csvText) => {
  const lines = String(csvText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((s) => s.trim());
  const idx = new Map(header.map((h, i) => [h, i]));

  const get = (cols, name) => cols[idx.get(name) ?? -1] ?? "";

  const rows = [];
  for (const line of lines.slice(1)) {
    // AVT CSVs are plain, no quoted commas.
    const cols = line.split(",");
    rows.push({ cols, get: (name) => get(cols, name) });
  }
  return rows;
};

const median = (values) => {
  const v = values
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  if (v.length % 2 === 1) return v[mid];
  return (v[mid - 1] + v[mid]) / 2;
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
  // Expand back to per-x values (each x appears exactly once)
  const yByX = new Map();
  for (const b of blocks) for (const x of b.xs) yByX.set(x, b.y);
  return points.map((p) => ({ x: p.x, y: yByX.get(p.x) ?? p.y }));
};

const round3 = (n) => Math.round(n * 1000) / 1000;

const frKey = (frameRate) => String(frameRate).trim().replaceAll(".", "p");

const slugify = (s) =>
  String(s ?? "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 32) || "unknown";

const sha1_8 = (s) =>
  crypto
    .createHash("sha1")
    .update(String(s ?? ""), "utf8")
    .digest("hex")
    .slice(0, 8);

const stripBitrateToken = (name) => {
  const s = String(name ?? "");
  // Common AVT naming: ..._<15000kbps>_... (bitrate differs per point)
  const stripped = s.replace(/_[0-9]+kbps_/gi, "_");
  return stripped === s ? s : stripped;
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

  const urls = [];
  for (const id of TEST_IDS) {
    urls.push(`${AVT_REPO_RAW_BASE}/test_${id}/metadata.csv`);
    urls.push(`${AVT_REPO_RAW_BASE}/test_${id}/objective_scores.csv`);
    urls.push(`${AVT_REPO_RAW_BASE}/test_${id}/mos_ci.csv`);
  }
  urls.push(`${AVT_REPO_RAW_BASE}/codec_retraining/data.csv`);

  const fetchedAtIso = new Date().toISOString();
  const texts = await Promise.all(urls.map((u) => fetchWithTimeout(u, timeoutMs)));

  const metaByKey = new Map();
  const mosByKey = new Map();
  const objectiveRows = [];

  let i = 0;
  for (const testId of TEST_IDS) {
    const metaText = texts[i++];
    const objText = texts[i++];
    const mosText = texts[i++];

    for (const r of parseCsv(metaText)) {
      const src = r.get("src");
      const name = r.get("video_name");
      metaByKey.set(`${src}|${name}`, {
        src,
        videoName: name,
        contentKey: stripBitrateToken(name),
        codec: r.get("video_codec"),
        width: Number(r.get("video_width")),
        height: Number(r.get("video_height")),
        frameRate: Number(r.get("video_frame_rate")),
        targetBitrateKbps: Number(r.get("video_target_bitrate")),
        testId,
      });
    }

    for (const r of parseCsv(mosText)) {
      const src = r.get("src");
      const name = r.get("video_name");
      mosByKey.set(`${src}|${name}`, {
        mos: Number(r.get("MOS")),
        ci: Number(r.get("CI")),
        testId,
      });
    }

    for (const r of parseCsv(objText)) {
      objectiveRows.push({
        src: r.get("src"),
        videoName: r.get("video_name"),
        targetBitrateKbps: Number(r.get("video_target_bitrate")),
        vmaf: Number(r.get("vmaf_score")),
        ssim: Number(r.get("ssim_score")),
        testId,
      });
    }
  }

  // Aggregate per (codec, resolution, frameRate) into bitrate→median(metric).
  const groups = new Map();
  const getGroup = (groupKey, meta) => {
    const existing = groups.get(groupKey);
    if (existing) return existing;
    const created = {
      meta,
      metrics: {
        vmaf: new Map(),
        ssim: new Map(),
      },
    };
    groups.set(groupKey, created);
    return created;
  };

  const pushValue = (groupKey, meta, metricName, bitrateKbps, value) => {
    if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) return;
    if (!Number.isFinite(value)) return;
    const group = getGroup(groupKey, meta);
    const bucket = group.metrics[metricName];
    const arr = bucket.get(bitrateKbps);
    if (arr) arr.push(value);
    else bucket.set(bitrateKbps, [value]);
  };

  // Per-content curves: keep per (src, contentKey, codec, resolution, frame_rate) as independent curves.
  const videoGroups = new Map();
  const getVideoGroup = (groupKey, meta) => {
    const existing = videoGroups.get(groupKey);
    if (existing) return existing;
    const created = {
      meta,
      metrics: {
        vmaf: new Map(),
        ssim: new Map(),
      },
    };
    videoGroups.set(groupKey, created);
    return created;
  };

  const pushVideoValue = (groupKey, meta, metricName, bitrateKbps, value) => {
    if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) return;
    if (!Number.isFinite(value)) return;
    const group = getVideoGroup(groupKey, meta);
    const bucket = group.metrics[metricName];
    const arr = bucket.get(bitrateKbps);
    if (arr) arr.push(value);
    else bucket.set(bitrateKbps, [value]);
  };

  for (const row of objectiveRows) {
    const meta = metaByKey.get(`${row.src}|${row.videoName}`);
    if (!meta) continue;
    if (
      !meta.codec ||
      !Number.isFinite(meta.width) ||
      !Number.isFinite(meta.height) ||
      !Number.isFinite(meta.frameRate)
    )
      continue;

    const groupKey = `${meta.codec}|${meta.width}x${meta.height}|${meta.frameRate}`;
    const groupMeta = { codec: meta.codec, width: meta.width, height: meta.height, frameRate: meta.frameRate };
    pushValue(groupKey, groupMeta, "vmaf", row.targetBitrateKbps, row.vmaf);
    pushValue(groupKey, groupMeta, "ssim", row.targetBitrateKbps, row.ssim);

    const videoGroupKey = `${meta.src}|${meta.contentKey}|${meta.codec}|${meta.width}x${meta.height}|${meta.frameRate}`;
    const videoGroupMeta = {
      src: meta.src,
      videoName: meta.contentKey,
      codec: meta.codec,
      width: meta.width,
      height: meta.height,
      frameRate: meta.frameRate,
    };
    pushVideoValue(videoGroupKey, videoGroupMeta, "vmaf", row.targetBitrateKbps, row.vmaf);
    pushVideoValue(videoGroupKey, videoGroupMeta, "ssim", row.targetBitrateKbps, row.ssim);
  }

  const datasets = [];
  const addDataset = (set, metric, key, label, points) => {
    datasets.push({ set, metric, key, label, points });
  };

  for (const { meta: gm, metrics } of groups.values()) {
    for (const metric of ["vmaf", "ssim"]) {
      const byBitrate = metrics[metric];
      const perBitrate = [...byBitrate.entries()].map(([bitrateKbps, values]) => {
        const med = median(values);
        return { x: bitrateKbps, y: med, w: values.length };
      });
      perBitrate.sort((a, b) => a.x - b.x);
      if (perBitrate.length < 4) continue;

      const monotone = enforceMonotone(perBitrate);

      const clamp = (v) => {
        if (metric === "vmaf") return Math.min(100, Math.max(0, v));
        return Math.min(1, Math.max(0, v));
      };

      const points = monotone.map((p) => ({ x: p.x, y: round3(clamp(p.y)) }));

      const key = `avt_${gm.codec}_${gm.width}x${gm.height}_${frKey(gm.frameRate)}fps`;
      const label = `AVT-VQDB-UHD-1 ${gm.codec} ${gm.width}x${gm.height} @${gm.frameRate}fps (median)`;
      addDataset(1, metric, key, label, points);
      addDataset(2, metric, key, label, points);
    }
  }

  for (const { meta: gm, metrics } of videoGroups.values()) {
    for (const metric of ["vmaf", "ssim"]) {
      const byBitrate = metrics[metric];
      const perBitrate = [...byBitrate.entries()].map(([bitrateKbps, values]) => {
        const med = median(values);
        return { x: bitrateKbps, y: med, w: values.length };
      });
      perBitrate.sort((a, b) => a.x - b.x);
      if (perBitrate.length < 2) continue;

      const monotone = enforceMonotone(perBitrate);

      const clamp = (v) => {
        if (metric === "vmaf") return Math.min(100, Math.max(0, v));
        return Math.min(1, Math.max(0, v));
      };

      const points = monotone.map((p) => ({ x: p.x, y: round3(clamp(p.y)) }));

      const hash = sha1_8(`${gm.src}|${gm.videoName}|${gm.codec}|${gm.width}x${gm.height}|${gm.frameRate}`);
      const key = `avt_u1_${gm.codec}_${gm.width}x${gm.height}_${frKey(gm.frameRate)}fps_${slugify(gm.src)}_${slugify(gm.videoName)}_${hash}`;
      const label = `AVT-VQDB-UHD-1 ${gm.codec} ${gm.width}x${gm.height} @${gm.frameRate}fps ${gm.src}/${gm.videoName} (median)`;
      addDataset(1, metric, key, label, points);
      addDataset(2, metric, key, label, points);
    }
  }

  const snapshot = {
    source: {
      homepageUrl: "https://telecommunication-telemedia-assessment.github.io/AVT-VQDB-UHD-1/",
      dataUrl: AVT_REPO_RAW_BASE,
      title: "AVT-VQDB-UHD-1 (derived curves)",
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
      `datasets: ${datasets.length} (unique keys=${new Set(datasets.map((d) => d.key)).size})`,
    ].join("\n") + "\n",
  );
};

await main();
