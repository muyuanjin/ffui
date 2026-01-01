#!/usr/bin/env node
/**
 * One-shot builder: downloads/derives all currently supported sources and merges them.
 *
 * Current sources:
 * - rigaya/vq_results (vq_results_data.js)
 * - AVT-VQDB-UHD-1 (test result CSVs; no videos)
 * - AVT-VQDB-UHD-1-HDR (VMAF JSON reports; no videos)
 * - AVT-VQDB-UHD-1-Appeal (VMAF JSON reports; no videos)
 * - Xiph AWCY csv_export.csv (no videos)
 * - Mendeley Data 10.17632/35735kfjnm.1 (XLSX tables; no videos)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-quality-snapshot.mjs [--out <path>]",
      "",
      "Options:",
      "  --out <path>        Output merged snapshot path (must not already exist)",
      "                     (default: public/vq/quality_snapshot.json)",
      "  --pretty            Pretty-print JSON",
      "  --timeout-ms <ms>   Network timeout for source fetches (default 60000)",
      "",
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { outPath: "public/vq/quality_snapshot.json", pretty: false, timeoutMs: 60_000 };
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
  return out;
};

const ensureNotExists = async (p) => {
  try {
    await fs.access(p);
    throw new Error(`refusing to overwrite existing file: ${p}`);
  } catch {
    // ok
  }
};

const pad2 = (n) => String(n).padStart(2, "0");

const recoveryStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(
    d.getMinutes(),
  )}${pad2(d.getSeconds())}`;
};

const sha256OfFile = async (p) => {
  const buf = await fs.readFile(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
};

const pathExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const safeReplaceWithRecovery = async (outPath, nextPath) => {
  const exists = await pathExists(outPath);
  if (!exists) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.rename(nextPath, outPath);
    return { changed: true, recoveryDir: null };
  }

  const [a, b] = await Promise.all([sha256OfFile(outPath), sha256OfFile(nextPath)]);
  if (a === b) return { changed: false, recoveryDir: null };

  const stamp = recoveryStamp();
  const recoveryDir = path.join("recovery", "ffui", stamp);
  const dest = path.join(recoveryDir, outPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(outPath, dest);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.rename(nextPath, outPath);

  const manifest = [
    "# Recovery Manifest",
    "",
    `timestamp: ${stamp}`,
    "operator: codex",
    "",
    "moved:",
    `- from: ${outPath}`,
    `  to: ${dest}`,
    "reason: replace unified quality snapshot with a regenerated one (kept recoverable copy)",
    "",
  ].join("\n");
  await fs.writeFile(path.join(recoveryDir, "MANIFEST.md"), manifest, { encoding: "utf8", flag: "wx" });
  return { changed: true, recoveryDir };
};

const summarizeDatasetMix = (snapshot) => {
  const ds = Array.isArray(snapshot?.datasets) ? snapshot.datasets : [];
  let vq = 0;
  let awcy = 0;
  let avtUhd = 0;
  let avtHdr = 0;
  let avtAppeal = 0;
  let mendeley = 0;
  for (const d of ds) {
    const k = String(d?.key ?? "");
    if (k.startsWith("awcy_")) {
      awcy += 1;
      continue;
    }
    if (k.startsWith("avt_hdr_")) {
      avtHdr += 1;
      continue;
    }
    if (k.startsWith("avt_appeal_")) {
      avtAppeal += 1;
      continue;
    }
    if (k.startsWith("avt_")) {
      avtUhd += 1;
      continue;
    }
    if (k.startsWith("md35735_")) {
      mendeley += 1;
      continue;
    }
    vq += 1;
  }
  const total = ds.length || 0;
  const fmt = (n) => `${n}/${total} (${total ? ((n / total) * 100).toFixed(2) : "0.00"}%)`;
  return {
    total,
    vq_results: fmt(vq),
    "AVT-VQDB-UHD-1": fmt(avtUhd),
    "AVT-VQDB-UHD-1-HDR": fmt(avtHdr),
    "AVT-VQDB-UHD-1-Appeal": fmt(avtAppeal),
    "Xiph AWCY": fmt(awcy),
    "Mendeley 35735kfjnm": fmt(mendeley),
  };
};

const main = async () => {
  const { outPath, pretty, timeoutMs } = parseArgs();
  const isDefaultOut = outPath === "public/vq/quality_snapshot.json";
  if (!isDefaultOut) await ensureNotExists(outPath);

  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replaceAll(".", "");
  const tmpDir = path.join(".cache", "vq-results-datasets", "unified", stamp);
  await fs.mkdir(tmpDir, { recursive: true });

  const vqOut = path.join(tmpDir, "vq_results.snapshot.json");
  const avtOut = path.join(tmpDir, "avt_vqdb_uhd_1.snapshot.json");
  const avtHdrOut = path.join(tmpDir, "avt_vqdb_uhd_1_hdr.snapshot.json");
  const avtAppealOut = path.join(tmpDir, "avt_vqdb_uhd_1_appeal.snapshot.json");
  const awcyOut = path.join(tmpDir, "awcy_csv_export.snapshot.json");
  const mendeleyOut = path.join(tmpDir, "mendeley_35735kfjnm.snapshot.json");
  const mergedOut = path.join(tmpDir, "quality_snapshot.merged.json");

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-vq-results-snapshot.mjs"),
    "--out",
    vqOut,
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-avt-vqdb-uhd-1-curves.mjs"),
    "--out",
    avtOut,
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-avt-vqdb-uhd-1-hdr-curves.mjs"),
    "--out",
    avtHdrOut,
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-avt-vqdb-uhd-1-appeal-curves.mjs"),
    "--out",
    avtAppealOut,
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-awcy-csv-export-curves.mjs"),
    "--out",
    awcyOut,
    "--auto",
    "--auto-max-runs",
    "40",
    "--auto-max-per-family",
    "12",
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "build-mendeley-35735kfjnm-curves.mjs"),
    "--out",
    mendeleyOut,
    "--timeout-ms",
    String(timeoutMs),
  ]);

  await execFileAsync("node", [
    path.join("scripts", "vq-results", "merge-quality-snapshots.mjs"),
    "--out",
    mergedOut,
    "--in",
    vqOut,
    "--in",
    avtOut,
    "--in",
    avtHdrOut,
    "--in",
    avtAppealOut,
    "--in",
    awcyOut,
    "--in",
    mendeleyOut,
    ...(pretty ? ["--pretty"] : []),
  ]);

  if (isDefaultOut) {
    const result = await safeReplaceWithRecovery(outPath, mergedOut);
    process.stdout.write(`OK: merged snapshot at ${outPath}\n`);
    if (!result.changed) process.stdout.write("note: unchanged (hash match)\n");
    if (result.recoveryDir) process.stdout.write(`recovery: ${result.recoveryDir}\n`);
  } else {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.rename(mergedOut, outPath);
    process.stdout.write(`OK: merged snapshot at ${outPath}\n`);
  }

  try {
    const raw = await fs.readFile(outPath, "utf8");
    const snapshot = JSON.parse(raw);
    const mix = summarizeDatasetMix(snapshot);
    process.stdout.write(`mix: ${JSON.stringify(mix)}\n`);
  } catch {
    // ignore
  }
  process.stdout.write(`tmp: ${tmpDir}\n`);
};

await main();
