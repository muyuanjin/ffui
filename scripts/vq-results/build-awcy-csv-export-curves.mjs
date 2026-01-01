#!/usr/bin/env node
/**
 * Build compact bitrate→quality curves from arewecompressedyet.com (Xiph AWCY) `csv_export.csv`.
 *
 * - Downloads only small CSV test-result files (NO videos).
 * - Aggregates across clips by QP (median bitrate/metric per QP).
 * - Emits VqResultsSnapshot-compatible JSON so it can be merged with vq_results data later.
 */

import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 60_000;

const AWCY_BASE = "https://arewecompressedyet.com/";

const DEFAULT_AUTO_MAX_RUNS = 80;
const DEFAULT_AUTO_MAX_PER_FAMILY = 20;

const DEFAULT_RUN_IDS = [
  "x264-medium@2022-10-31T21:19:39.857Z",
  "x265-slower@2022-11-08T17:41:56.927Z",
  "vp9-realtime@2022-10-31T21:21:45.153Z",
  "av1_baseline_cpu1@2024-08-16T13:27:04.315Z",
  "master-e34e772e47b01169b6f75a4589c056624ea886a4",
  "baseline@2025-01-07T19:56:59.195Z",
];

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-awcy-csv-export-curves.mjs --out <path> [--run-id <id> ...] [--auto]",
      "",
      "Options:",
      "  --out <path>       Output JSON path (must not already exist)",
      "  --run-id <id>      Include a specific AWCY run_id (repeatable; default uses a curated list)",
      "  --auto             Auto-select recent AWCY runs that provide csv_export.csv (adds diversity; no videos)",
      `  --auto-max-runs <n>        Max auto-selected runs (default ${DEFAULT_AUTO_MAX_RUNS})`,
      `  --auto-max-per-family <n> Max auto-selected runs per codec family (default ${DEFAULT_AUTO_MAX_PER_FAMILY})`,
      "  --pretty           Pretty-print JSON",
      "  --timeout-ms <ms>  Per-request timeout (default 60000)",
      "",
    ].join("\n") + "\n",
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    outPath: "",
    runIds: [],
    auto: false,
    autoMaxRuns: DEFAULT_AUTO_MAX_RUNS,
    autoMaxPerFamily: DEFAULT_AUTO_MAX_PER_FAMILY,
    pretty: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--out") {
      out.outPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--run-id") {
      out.runIds.push(String(args[i + 1] ?? ""));
      i += 1;
      continue;
    }
    if (a === "--auto") {
      out.auto = true;
      continue;
    }
    if (a === "--auto-max-runs") {
      out.autoMaxRuns = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--auto-max-per-family") {
      out.autoMaxPerFamily = Number(args[i + 1] ?? "");
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
  if (!Number.isFinite(out.autoMaxRuns) || out.autoMaxRuns <= 0) {
    throw new Error(`invalid --auto-max-runs: ${out.autoMaxRuns}`);
  }
  if (!Number.isFinite(out.autoMaxPerFamily) || out.autoMaxPerFamily <= 0) {
    throw new Error(`invalid --auto-max-per-family: ${out.autoMaxPerFamily}`);
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

const fetchJsonWithTimeout = async (url, timeoutMs) => {
  const raw = await fetchWithTimeout(url, timeoutMs);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse failed for ${url}: ${String(e)}`);
  }
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
    // AWCY csv_export is plain, no quoted commas.
    const cols = line.split(",");
    rows.push({ cols, get: (name) => get(cols, name) });
  }
  return { header, rows };
};

const awcyFamilyOfRunId = (runId) => {
  const s = String(runId ?? "").toLowerCase();
  if (s.includes("x264")) return "x264";
  if (s.includes("x265")) return "x265";
  if (s.includes("vp9")) return "vp9";
  if (s.includes("av1") || s.includes("aom") || s.includes("rav1e") || s.includes("svt")) return "av1";
  if (s.includes("vvc") || s.includes("vvenc")) return "vvc";
  return "other";
};

const parseMaybeDate = (v) => {
  const d = new Date(String(v ?? ""));
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
};

const selectAutoRunIds = async ({ timeoutMs, maxRuns, maxPerFamily }) => {
  const listUrl = new URL("list.json", AWCY_BASE).toString();
  const list = await fetchJsonWithTimeout(listUrl, timeoutMs);
  if (!Array.isArray(list)) throw new Error(`unexpected list.json shape (expected array), got ${typeof list}`);

  const candidates = list
    .map((x) => ({
      runId: String(x?.run_id ?? ""),
      tasks: Array.isArray(x?.tasks) ? x.tasks.map((t) => String(t)) : [],
      ts: parseMaybeDate(x?.date),
      failed: Boolean(x?.failed),
    }))
    .filter((x) => x.runId.length > 0)
    .filter((x) => !x.failed)
    .filter((x) => x.tasks.includes("csv_export.csv"))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0) || a.runId.localeCompare(b.runId));

  const selected = [];
  const perFamily = new Map();
  for (const c of candidates) {
    if (selected.length >= maxRuns) break;
    const fam = awcyFamilyOfRunId(c.runId);
    const count = perFamily.get(fam) ?? 0;
    if (count >= maxPerFamily) continue;
    selected.push(c.runId);
    perFamily.set(fam, count + 1);
  }
  return selected;
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (n) => Math.round(n * 1000) / 1000;

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

const ssimDbToLinear = (db) => {
  // Common transform for (MS-)SSIM in dB: -10*log10(1-ssim).
  // Invert it: ssim = 1 - 10^(-db/10).
  const v = 1 - 10 ** (-Number(db) / 10);
  return clamp(v, 0, 1);
};

const main = async () => {
  const { outPath, pretty, timeoutMs, runIds: requestedRunIds, auto, autoMaxRuns, autoMaxPerFamily } = parseArgs();

  // Prefer IPv4 to avoid IPv6-only connect timeouts on some hosts.
  dns.setDefaultResultOrder("ipv4first");

  try {
    await fs.access(outPath);
    throw new Error(`refusing to overwrite existing file: ${outPath}`);
  } catch {
    // ok
  }

  const autoRunIds = auto
    ? await selectAutoRunIds({
        timeoutMs: Math.max(timeoutMs, 90_000),
        maxRuns: autoMaxRuns,
        maxPerFamily: autoMaxPerFamily,
      })
    : [];

  const baseRunIds = requestedRunIds.length > 0 ? requestedRunIds : autoRunIds.length > 0 ? [] : DEFAULT_RUN_IDS;

  const runIds = Array.from(new Set([...baseRunIds, ...autoRunIds].filter(Boolean)));
  if (runIds.length === 0) throw new Error("no --run-id provided and default list is empty");

  const fetchedAtIso = new Date().toISOString();

  const datasets = [];
  const addDataset = (set, metric, key, label, points) => datasets.push({ set, metric, key, label, points });

  for (const runId of runIds) {
    const url = new URL(`runs/${encodeURIComponent(runId)}/csv_export.csv`, AWCY_BASE).toString();
    let csvText = "";
    try {
      csvText = await fetchWithTimeout(url, timeoutMs);
    } catch (e) {
      process.stderr.write(`warn: failed to fetch csv_export.csv for run_id=${runId}: ${String(e)}\n`);
      continue;
    }
    const parsed = parseCsv(csvText);
    if (!parsed || !Array.isArray(parsed.rows)) continue;

    const { rows } = parsed;

    const groups = new Map();
    const getGroup = (groupKey, meta) => {
      const existing = groups.get(groupKey);
      if (existing) return existing;
      const created = {
        meta,
        // bucket by QP (not bitrate) so the curve is a proper RD sweep.
        qp: {
          vmaf: new Map(),
          ssim: new Map(),
          bitrate: new Map(),
        },
      };
      groups.set(groupKey, created);
      return created;
    };

    for (const r of rows) {
      const qp = Number(r.get("QP"));
      const bitrateKbps = Number(r.get("Bitrate(kbps)"));
      const vmaf = Number(r.get("VMAF_Y"));
      const ssimDb = Number(r.get("SSIM_Y(dB)"));

      const codedRes = String(r.get("CodedRes") || r.get("OrigRes") || "").trim();
      const codecName = String(r.get("CodecName") || runId).trim();
      const encodePreset = String(r.get("EncodePreset") || r.get("EncodeMethod") || "").trim();
      const cls = String(r.get("Class") || "").trim();
      const testCfg = String(r.get("TestCfg") || "").trim();

      if (!Number.isFinite(qp) || !Number.isFinite(bitrateKbps) || bitrateKbps <= 0) continue;
      if (!codedRes) continue;

      const groupKey = `${codecName}|${encodePreset}|${testCfg}|${cls}|${codedRes}`;
      const meta = { codecName, encodePreset, testCfg, cls, codedRes };
      const g = getGroup(groupKey, meta);

      const push = (bucket, value) => {
        if (!Number.isFinite(value)) return;
        const arr = bucket.get(qp);
        if (arr) arr.push(value);
        else bucket.set(qp, [value]);
      };

      push(g.qp.bitrate, bitrateKbps);
      push(g.qp.vmaf, vmaf);
      push(g.qp.ssim, ssimDb);
    }

    for (const { meta, qp } of groups.values()) {
      const qpValues = Array.from(qp.bitrate.keys()).sort((a, b) => a - b);
      if (qpValues.length < 2) continue;

      const pointsByMetric = {
        vmaf: [],
        ssim: [],
      };

      for (const q of qpValues) {
        const br = median(qp.bitrate.get(q) ?? []);
        if (!Number.isFinite(br) || br <= 0) continue;

        const v = median(qp.vmaf.get(q) ?? []);
        if (Number.isFinite(v)) pointsByMetric.vmaf.push({ x: br, y: v, w: (qp.vmaf.get(q) ?? []).length });

        const ssimDb = median(qp.ssim.get(q) ?? []);
        if (Number.isFinite(ssimDb))
          pointsByMetric.ssim.push({ x: br, y: ssimDbToLinear(ssimDb), w: (qp.ssim.get(q) ?? []).length });
      }

      for (const [metric, pts] of Object.entries(pointsByMetric)) {
        pts.sort((a, b) => a.x - b.x);
        if (pts.length < 2) continue;

        const monotone = enforceMonotone(pts);
        const clampY = (y) => (metric === "vmaf" ? clamp(y, 0, 100) : clamp(y, 0, 1));
        const points = monotone.map((p) => ({ x: round3(p.x), y: round3(clampY(p.y)) }));

        const stable = `${runId}|${meta.codecName}|${meta.encodePreset}|${meta.testCfg}|${meta.cls}|${meta.codedRes}|${metric}`;
        const key = `awcy_${slugify(meta.encodePreset || meta.codecName)}_${slugify(meta.cls || "na")}_${slugify(
          meta.codedRes,
        )}_${sha1_8(stable)}`;
        const label =
          `AWCY ${meta.encodePreset || meta.codecName} ${meta.cls || ""} ${meta.codedRes} (${metric} median-by-QP)`.trim();

        addDataset(1, metric, key, label, points);
        addDataset(2, metric, key, label, points);
      }
    }
  }

  const snapshot = {
    source: {
      homepageUrl: "https://arewecompressedyet.com/",
      dataUrl: "https://arewecompressedyet.com/list.json",
      title: "Xiph AWCY csv_export.csv (derived curves)",
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
      `runs: ${runIds.length}`,
      `datasets: ${datasets.length} (unique keys=${new Set(datasets.map((d) => d.key)).size})`,
    ].join("\n") + "\n",
  );
};

await main();
