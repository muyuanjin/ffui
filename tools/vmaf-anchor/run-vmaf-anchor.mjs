#!/usr/bin/env node
/**
 * Build a local VMAF anchor for ffui "smart presets" using a single reference video.
 *
 * Goals:
 * - Provide a reproducible, opt-in "ground truth" dataset for tuning/validating
 *   the curve predictor (without adding heavy/CI-breaking tests).
 * - Keep results in a timestamped output dir (never overwrite).
 *
 * Usage:
 *   node tools/vmaf-anchor/run-vmaf-anchor.mjs --input <path>
 *
 * Optional:
 *   node tools/vmaf-anchor/run-vmaf-anchor.mjs --download-bbb --input <ignored>   (downloads ref into out dir)
 *
 * Output:
 *   <out-dir>/anchor.json
 *   <out-dir>/outputs/<preset-id>.<ext>
 *   <out-dir>/vmaf/<preset-id>.json
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BBB_URL = "https://raw.githubusercontent.com/bower-media-samples/big-buck-bunny-1080p-30s/master/video.mp4";

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node tools/vmaf-anchor/run-vmaf-anchor.mjs --input <path>",
      "",
      "Options:",
      "  --input <path>         Reference input video path (required unless --download-bbb)",
      "  --download-bbb         Download Big Buck Bunny 1080p 30s into the output dir and use it as reference",
      "  --out-dir <path>       Output directory (default .cache/vmaf-anchor/<stamp>)",
      "  --presets <path>       Presets JSON (default src-tauri/assets/smart-presets.json)",
      "  --snapshot <path>      quality_snapshot.json (default public/vq/quality_snapshot.json)",
      "  --limit <n>            Only run first N presets (default all)",
      "  --ids <csv>            Only run selected preset ids (comma-separated, matches preset.id)",
      "  --encoders <csv>       Only run selected encoders (comma-separated, matches preset.video.encoder)",
      "  --default-selected     Only run presets with defaultSelected=true",
      "  --expose-only          Only run presets with expose=true",
      "  --trim <seconds>       Only encode + measure first N seconds (reduces runtime; default full input)",
      "",
    ].join("\n") + "\n",
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    inputPath: "",
    downloadBbb: false,
    outDir: "",
    presetsPath: "src-tauri/assets/smart-presets.json",
    snapshotPath: "public/vq/quality_snapshot.json",
    limit: null,
    ids: [],
    encoders: [],
    defaultSelectedOnly: false,
    exposeOnly: false,
    trimSeconds: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--input") {
      out.inputPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--download-bbb") {
      out.downloadBbb = true;
      continue;
    }
    if (a === "--out-dir") {
      out.outDir = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--presets") {
      out.presetsPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--snapshot") {
      out.snapshotPath = String(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--limit") {
      out.limit = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--ids") {
      out.ids = String(args[i + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (a === "--encoders") {
      out.encoders = String(args[i + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (a === "--default-selected") {
      out.defaultSelectedOnly = true;
      continue;
    }
    if (a === "--expose-only") {
      out.exposeOnly = true;
      continue;
    }
    if (a === "--trim") {
      out.trimSeconds = Number(args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    }
  }

  if (!out.downloadBbb && !out.inputPath) {
    usage();
    process.exit(2);
  }
  if (out.limit != null && (!Number.isFinite(out.limit) || out.limit <= 0)) {
    throw new Error(`invalid --limit: ${out.limit}`);
  }
  if (out.trimSeconds != null && (!Number.isFinite(out.trimSeconds) || out.trimSeconds <= 0)) {
    throw new Error(`invalid --trim: ${out.trimSeconds}`);
  }
  return out;
};

const pad2 = (n) => String(n).padStart(2, "0");
const stampUtc = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(
    d.getUTCMinutes(),
  )}${pad2(d.getUTCSeconds())}`;
};

const pathExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = async (p) => {
  await fs.mkdir(p, { recursive: true });
};

const sha256OfFile = async (p) => {
  const hash = crypto.createHash("sha256");
  const stream = fsSync.createReadStream(p);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

const writeJsonNoOverwrite = async (p, value) => {
  await ensureDir(path.dirname(p));
  const json = JSON.stringify(value, null, 2);
  await fs.writeFile(p, json, { encoding: "utf8", flag: "wx" });
};

const getFfmpegVersionLine = async () => {
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true });
  return String(stdout).split(/\r?\n/g)[0] ?? "";
};

const listFfmpegEncoders = async () => {
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"], {
    windowsHide: true,
    maxBuffer: 10_000_000,
  });
  const text = String(stdout);
  const encoders = new Set();
  for (const line of text.split(/\r?\n/g)) {
    // Example: " V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)"
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[A-Z.]{6}$/.test(parts[0] ?? "")) {
      encoders.add(parts[1]);
    }
  }
  return encoders;
};

const getCqArgForEncoder = (encoder) => {
  const raw = String(encoder ?? "").toLowerCase();
  if (raw.includes("_qsv")) return "-global_quality";
  return "-cq";
};

const sanitizeId = (raw) =>
  String(raw ?? "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120) || "preset";

const buildRunId = (preset) => {
  const presetId = String(preset?.id ?? "").trim();
  const encoder = String(preset?.video?.encoder ?? "").trim();
  const base = presetId ? `${presetId}__${encoder || "noenc"}` : encoder || "preset";
  return sanitizeId(base);
};

const outputExtForPreset = (preset) => {
  const fmt = String(preset?.container?.format ?? "")
    .trim()
    .toLowerCase();
  if (fmt === "mkv" || fmt === "matroska") return ".mkv";
  if (fmt === "ts" || fmt === "m2ts" || fmt === "mpegts") return ".ts";
  if (fmt === "rm" || fmt === "rmvb") return ".rm";
  // Default mp4 is fine for most presets.
  return ".mp4";
};

const buildFfmpegArgsFromSmartPreset = (preset, inputPath, outputPath) => {
  const v = preset.video ?? {};
  const a = preset.audio ?? {};

  const args = ["-progress", "pipe:2", "-nostdin", "-i", inputPath, "-map", "0"];

  const encoder = String(v.encoder ?? "");
  if (!encoder) throw new Error(`missing video.encoder for preset ${String(preset?.id ?? preset?.name ?? "unknown")}`);

  if (encoder === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", encoder);

    const rateControl = String(v.rateControl ?? "").toLowerCase();
    const q = Number(v.qualityValue);

    if (rateControl === "constqp") {
      args.push("-rc", "constqp", "-qp", String(q));
    } else if (rateControl === "crf") {
      args.push("-crf", String(q));
    } else if (rateControl === "cq") {
      const encLower = encoder.toLowerCase();
      if (encLower.includes("_amf")) {
        args.push("-qp_i", String(q), "-qp_p", String(q));
      } else {
        args.push(getCqArgForEncoder(encoder), String(q));
      }
    } else if (rateControl === "cbr" || rateControl === "vbr") {
      const bitrateKbps = Number(v.bitrateKbps);
      if (Number.isFinite(bitrateKbps) && bitrateKbps > 0) args.push("-b:v", `${bitrateKbps}k`);
      const maxBitrateKbps = Number(v.maxBitrateKbps);
      if (Number.isFinite(maxBitrateKbps) && maxBitrateKbps > 0) args.push("-maxrate", `${maxBitrateKbps}k`);
      const bufferSizeKbits = Number(v.bufferSizeKbits);
      if (Number.isFinite(bufferSizeKbits) && bufferSizeKbits > 0) args.push("-bufsize", `${bufferSizeKbits}k`);
    }

    const presetValue = String(v.preset ?? "").trim();
    if (presetValue) args.push("-preset", presetValue);
    const tune = String(v.tune ?? "").trim();
    if (tune) args.push("-tune", tune);

    const gopSize = Number(v.gopSize);
    if (Number.isFinite(gopSize) && gopSize > 0) args.push("-g", String(gopSize));
    const bf = Number(v.bf);
    if (Number.isFinite(bf) && bf >= 0) args.push("-bf", String(bf));

    const pixFmt = String(v.pixFmt ?? "").trim();
    if (pixFmt) args.push("-pix_fmt", pixFmt);

    const bRefMode = String(v.bRefMode ?? "").trim();
    if (bRefMode) args.push("-b_ref_mode", bRefMode);
    const rcLookahead = Number(v.rcLookahead);
    if (Number.isFinite(rcLookahead) && rcLookahead > 0) args.push("-rc-lookahead", String(rcLookahead));
    if (v.spatialAq === true) args.push("-spatial-aq", "1");
    if (v.temporalAq === true) args.push("-temporal-aq", "1");
  }

  const codec = String(a.codec ?? "").toLowerCase();
  if (codec === "copy") {
    args.push("-c:a", "copy");
  } else if (codec === "aac") {
    args.push("-c:a", "aac");
    const bitrate = Number(a.bitrate);
    if (Number.isFinite(bitrate) && bitrate > 0) args.push("-b:a", `${bitrate}k`);
  } else {
    args.push("-c:a", String(a.codec ?? "copy"));
  }

  args.push(outputPath);
  return args;
};

const computeVmafMean = async (refPath, distPath, logPath, options) => {
  await ensureDir(path.dirname(logPath));

  // NOTE: ffmpeg filter args treat backslashes as escapes; normalize to forward
  // slashes to keep paths portable across Windows/WSL runs.
  const logPathForFilter = String(logPath).replaceAll("\\", "/");

  // Use the default libvmaf model and keep comparison in 8-bit 4:2:0,
  // because many references are 8-bit H.264 and we want a single baseline.
  const filter = [
    "[0:v]setpts=PTS-STARTPTS,format=yuv420p[ref]",
    "[1:v]setpts=PTS-STARTPTS,format=yuv420p[dist]",
    `[dist][ref]libvmaf=log_fmt=json:log_path=${logPathForFilter}`,
  ].join(";");

  const trimSeconds = options?.trimSeconds;
  const timeArgs =
    typeof trimSeconds === "number" && Number.isFinite(trimSeconds) && trimSeconds > 0
      ? ["-t", String(trimSeconds)]
      : [];

  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      ...timeArgs,
      "-i",
      refPath,
      ...timeArgs,
      "-i",
      distPath,
      "-lavfi",
      filter,
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true, maxBuffer: 10_000_000 },
  );

  const json = await readJson(logPath);
  const mean = Number(json?.pooled_metrics?.vmaf?.mean);
  if (!Number.isFinite(mean)) throw new Error(`unexpected VMAF log: ${logPath}`);
  return mean;
};

const main = async () => {
  const {
    inputPath,
    downloadBbb,
    outDir: outDirArg,
    presetsPath,
    snapshotPath,
    limit,
    ids,
    encoders,
    defaultSelectedOnly,
    exposeOnly,
    trimSeconds,
  } = parseArgs();

  const outDir = outDirArg || path.join(".cache", "vmaf-anchor", stampUtc());
  if (await pathExists(outDir)) {
    throw new Error(`refusing to overwrite existing out dir: ${outDir}`);
  }
  await ensureDir(outDir);

  const outputsDir = path.join(outDir, "outputs");
  const vmafDir = path.join(outDir, "vmaf");
  await ensureDir(outputsDir);
  await ensureDir(vmafDir);

  const refPath = downloadBbb ? path.join(outDir, "ref_video.mp4") : inputPath;
  if (downloadBbb) {
    const { stdout: ffmpegVersion } = await execFileAsync("ffmpeg", ["-hide_banner", "-version"], {
      windowsHide: true,
    });
    if (!String(ffmpegVersion).trim()) throw new Error("ffmpeg not available");

    const { stdout } = await execFileAsync(
      "curl",
      ["-fL", "--retry", "3", "--retry-delay", "1", "-o", refPath, BBB_URL],
      {
        windowsHide: true,
        maxBuffer: 1_000_000,
      },
    );
    void stdout;
  }

  const refExists = await pathExists(refPath);
  if (!refExists) throw new Error(`reference input not found: ${refPath}`);

  const [ffmpegVersionLine, availableEncoders, presetsJson] = await Promise.all([
    getFfmpegVersionLine(),
    listFfmpegEncoders(),
    readJson(presetsPath),
  ]);

  const presets = Array.isArray(presetsJson?.presets) ? presetsJson.presets : [];
  const pickedPresets = (() => {
    let out = presets;
    if (defaultSelectedOnly) out = out.filter((p) => p?.defaultSelected === true);
    if (exposeOnly) out = out.filter((p) => p?.expose === true);
    if (Array.isArray(ids) && ids.length > 0) {
      const set = new Set(ids.map((x) => String(x)));
      out = out.filter((p) => set.has(String(p?.id ?? "")));
    }
    if (Array.isArray(encoders) && encoders.length > 0) {
      const set = new Set(encoders.map((x) => String(x)));
      out = out.filter((p) => set.has(String(p?.video?.encoder ?? "")));
    }
    if (limit != null) out = out.slice(0, limit);
    return out;
  })();

  const refSha256 = await sha256OfFile(refPath);
  const presetsSha256 = await sha256OfFile(presetsPath);
  const snapshotSha256 = await sha256OfFile(snapshotPath);

  const results = [];
  const skipped = [];

  for (const preset of pickedPresets) {
    const encoder = String(preset?.video?.encoder ?? "");
    const presetId = String(preset?.id ?? "");
    const runId = buildRunId(preset);
    const name = String(preset?.name ?? runId);

    if (!encoder || encoder === "copy") {
      skipped.push({ runId, presetId, encoder, name, reason: "copy/no-video" });
      continue;
    }

    if (!availableEncoders.has(encoder)) {
      skipped.push({ runId, presetId, encoder, name, reason: `encoder not available: ${encoder}` });
      continue;
    }

    const ext = outputExtForPreset(preset);
    const outputPath = path.join(outputsDir, `${runId}${ext}`);
    const vmafLogPath = path.join(vmafDir, `${runId}.json`);

    process.stdout.write(`==> ${runId} (${encoder})\n`);

    const args = buildFfmpegArgsFromSmartPreset(preset, refPath, outputPath);
    const timeArgs =
      typeof trimSeconds === "number" && Number.isFinite(trimSeconds) && trimSeconds > 0
        ? ["-t", String(trimSeconds)]
        : [];

    await execFileAsync("ffmpeg", ["-hide_banner", ...timeArgs, ...args], {
      windowsHide: true,
      maxBuffer: 10_000_000,
    });

    const vmafMean = await computeVmafMean(refPath, outputPath, vmafLogPath, { trimSeconds });

    const stat = await fs.stat(outputPath);

    results.push({
      runId,
      presetId,
      name,
      encoder,
      preset,
      output: {
        path: outputPath,
        sizeBytes: stat.size,
      },
      vmaf: {
        mean: vmafMean,
        logPath: vmafLogPath,
      },
      predicted: null,
    });
  }

  const anchor = {
    schemaVersion: 2,
    generatedAtIso: new Date().toISOString(),
    ffmpeg: {
      versionLine: ffmpegVersionLine,
    },
    reference: {
      path: refPath,
      sha256: refSha256,
      source: downloadBbb ? BBB_URL : null,
    },
    inputs: {
      presetsPath,
      presetsSha256,
      snapshotPath,
      snapshotSha256,
      trimSeconds,
    },
    results,
    skipped,
  };

  const outPath = path.join(outDir, "anchor.json");
  await writeJsonNoOverwrite(outPath, anchor);

  process.stdout.write(`OK: wrote ${outPath}\n`);
  process.stdout.write(`ran: ${results.length}\n`);
  process.stdout.write(`skipped: ${skipped.length}\n`);
};

await main();
