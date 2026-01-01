#!/usr/bin/env node
/**
 * Build compact bitrate→quality curves from Mendeley Data dataset 10.17632/35735kfjnm.1.
 *
 * - Downloads only the small XLSX spreadsheets from the dataset root (NO videos).
 * - Extracts VMAF/SSIM and derives bitrate curves grouped by:
 *   (codec family, scene, resolution, packet loss rate).
 * - Emits VqResultsSnapshot-compatible JSON so it can be merged into the unified snapshot.
 *
 * Data source:
 * - https://data.mendeley.com/datasets/35735kfjnm/1  (CC BY 4.0)
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const DEFAULT_TIMEOUT_MS = 60_000;

const DATASET_ID = "35735kfjnm";
const DATASET_VERSION = 1;
const MENDELEY_HOST = "data.mendeley.com";

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/vq-results/build-mendeley-35735kfjnm-curves.mjs --out <path>",
      "",
      "Options:",
      "  --out <path>       Output JSON path (must not already exist)",
      "  --pretty           Pretty-print JSON",
      `  --timeout-ms <ms>  Per-request timeout (default ${DEFAULT_TIMEOUT_MS})`,
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

const fetchWithTimeout = async (url, timeoutMs, init = {}) => {
  const attempt = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        ...init,
        headers: { "User-Agent": "Mozilla/5.0", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
      return res;
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

const fetchJson = async (url, timeoutMs, init = {}) => {
  const res = await fetchWithTimeout(url, timeoutMs, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse failed: ${String(e)} (${url})`);
  }
};

const fetchBuffer = async (url, timeoutMs, init = {}) => {
  const res = await fetchWithTimeout(url, timeoutMs, init);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
};

const decodeXmlText = (s) =>
  String(s ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");

const readZipCentralDirectory = (buf) => {
  // Find EOCD (end of central directory). Max comment length is 65535.
  const maxBack = Math.min(buf.length, 65_536 + 22);
  const start = buf.length - maxBack;
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: EOCD not found");

  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const end = cdOffset + cdSize;
  if (end > buf.length) throw new Error("zip: central directory out of bounds");

  const entries = new Map();
  let p = cdOffset;
  while (p + 46 <= end) {
    const sig = buf.readUInt32LE(p);
    if (sig !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const nameStart = p + 46;
    const name = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    p = nameStart + nameLen + extraLen + commentLen;
  }

  return entries;
};

const unzipEntry = (zipBuf, entries, entryName) => {
  const meta = entries.get(entryName);
  if (!meta) throw new Error(`zip: missing entry: ${entryName}`);

  const p = meta.localOffset;
  if (zipBuf.readUInt32LE(p) !== 0x04034b50) throw new Error(`zip: invalid local header: ${entryName}`);
  const nameLen = zipBuf.readUInt16LE(p + 26);
  const extraLen = zipBuf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const dataEnd = dataStart + meta.compressedSize;
  if (dataEnd > zipBuf.length) throw new Error(`zip: entry out of bounds: ${entryName}`);
  const compressed = zipBuf.slice(dataStart, dataEnd);

  if (meta.method === 0) return compressed;
  if (meta.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`zip: unsupported compression method ${meta.method} (${entryName})`);
};

const parseSharedStrings = (xml) => {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const si = m[1] ?? "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    const parts = [];
    let tm;
    while ((tm = tRe.exec(si))) parts.push(decodeXmlText(tm[1] ?? ""));
    out.push(parts.join("").trim());
  }
  return out;
};

const parseCellsFromRowXml = (rowXml, sharedStrings) => {
  const cells = new Map();
  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cRe.exec(rowXml))) {
    const attrs = String(m[1] ?? "");
    const body = String(m[2] ?? "");
    const refMatch = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!refMatch) continue;
    const col = refMatch[1] ?? "";
    const tMatch = attrs.match(/\bt="([^"]+)"/);
    const type = tMatch?.[1] ?? "";
    const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
    if (!vMatch) continue;
    const vRaw = decodeXmlText(vMatch[1] ?? "").trim();

    if (type === "s") {
      const idx = Number(vRaw);
      if (Number.isFinite(idx)) cells.set(col, sharedStrings[idx] ?? "");
      continue;
    }

    const n = Number(vRaw);
    if (Number.isFinite(n)) cells.set(col, n);
  }
  return cells;
};

const findHeader = (sheetXml, sharedStrings) => {
  const sheetDataMatch = sheetXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("xlsx: missing <sheetData>");
  const sheetData = sheetDataMatch[1] ?? "";

  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  for (let scanned = 0; scanned < 20 && (m = rowRe.exec(sheetData)); scanned += 1) {
    const rowXml = m[2] ?? "";
    const cells = parseCellsFromRowXml(rowXml, sharedStrings);
    const entries = Array.from(cells.entries()).filter(([, v]) => typeof v === "string");
    const asSet = new Set(entries.map(([, v]) => String(v).trim()));
    if (!asSet.has("SSIM") || !asSet.has("VMAF")) continue;

    let ssimCol = null;
    let vmafCol = null;
    let nameCol = null;
    for (const [col, v] of entries) {
      const s = String(v).trim();
      if (s === "SSIM") ssimCol = col;
      if (s === "VMAF") vmafCol = col;
      if (s.toLowerCase().includes("name of video")) nameCol = col;
      if (s.toLowerCase().includes("name of videosequence")) nameCol = col;
    }
    return { nameCol: nameCol ?? "A", ssimCol, vmafCol };
  }
  return { nameCol: "A", ssimCol: null, vmafCol: null };
};

const normalizeName = (name) => {
  const s = String(name ?? "").trim();
  if (!s) return "";
  return s.replaceAll(/\s+/g, "").replaceAll("FullHD", "FHD").replaceAll(/__+/g, "_").replaceAll(/_+$/g, "");
};

const parsePacketLoss = (token) => {
  const s = String(token ?? "").trim();
  if (!s) return 0;
  if (s.includes("_")) {
    const n = Number(s.replace("_", "."));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const resolutionToDims = (res) => {
  const r = String(res ?? "").toUpperCase();
  if (r === "HD") return { w: 1280, h: 720 };
  if (r === "FHD") return { w: 1920, h: 1080 };
  if (r === "UHD") return { w: 3840, h: 2160 };
  return null;
};

const parseSequenceName = (rawName) => {
  const name = normalizeName(rawName);
  if (!name) return null;

  // NOTE: make the scene match non-greedy so we don't accidentally absorb the
  // leading "F" of "FHD" and misparse resolution as "HD".
  const m = name.match(/^([A-Za-z]+?)_?(X)?_?(UHD|FHD|HD)(5|10|15)(?:_([0-9]+(?:_[0-9]+)?))?$/i);
  if (!m) return null;

  const scene = String(m[1] ?? "").trim() || "Unknown";
  const isHevc = String(m[2] ?? "").toUpperCase() === "X";
  const res = String(m[3] ?? "").toUpperCase();
  const bitrateMbit = Number(m[4] ?? "");
  const lossToken = m[5] ?? "";

  const dims = resolutionToDims(res);
  if (!dims) return null;
  if (!Number.isFinite(bitrateMbit) || bitrateMbit <= 0) return null;

  const packetLossPct = parsePacketLoss(lossToken);
  const bitrateKbps = bitrateMbit * 1000;
  return {
    scene,
    codec: isHevc ? "hevc" : "h264",
    width: dims.w,
    height: dims.h,
    bitrateKbps,
    packetLossPct,
  };
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

const listRootXlsxFiles = async (timeoutMs) => {
  const listUrl = `https://${MENDELEY_HOST}/public-api/datasets/${DATASET_ID}/files?folder_id=root&version=${DATASET_VERSION}`;
  const files = await fetchJson(listUrl, timeoutMs, {
    headers: { Accept: "application/vnd.mendeley-public-dataset.1+json" },
  });
  if (!Array.isArray(files)) throw new Error("mendeley: unexpected file list shape");
  return files
    .filter((f) => f && typeof f === "object")
    .filter((f) =>
      String(f.filename ?? "")
        .toLowerCase()
        .endsWith(".xlsx"),
    )
    .map((f) => ({
      filename: String(f.filename ?? ""),
      id: String(f.id ?? ""),
      sha256: String(f.content_details?.sha256_hash ?? ""),
      size: Number(f.content_details?.size ?? f.size ?? 0),
      downloadUrl: String(f.content_details?.download_url ?? ""),
    }))
    .filter((f) => f.filename && f.downloadUrl);
};

const loadRowsFromXlsxBuffer = (xlsxBuf) => {
  const entries = readZipCentralDirectory(xlsxBuf);
  const sharedXml = unzipEntry(xlsxBuf, entries, "xl/sharedStrings.xml").toString("utf8");
  const sheetXml = unzipEntry(xlsxBuf, entries, "xl/worksheets/sheet1.xml").toString("utf8");
  const sharedStrings = parseSharedStrings(sharedXml);
  const header = findHeader(sheetXml, sharedStrings);
  if (!header.ssimCol || !header.vmafCol) throw new Error("xlsx: failed to locate SSIM/VMAF columns");

  const sheetDataMatch = sheetXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("xlsx: missing <sheetData>");
  const sheetData = sheetDataMatch[1] ?? "";

  const rows = [];
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(sheetData))) {
    const rowXml = m[2] ?? "";
    const cells = parseCellsFromRowXml(rowXml, sharedStrings);

    const name = cells.get(header.nameCol);
    if (typeof name !== "string") continue;
    const ssim = cells.get(header.ssimCol);
    const vmaf = cells.get(header.vmafCol);
    if (typeof ssim !== "number" || typeof vmaf !== "number") continue;
    rows.push({ name, ssim, vmaf });
  }
  return rows;
};

const main = async () => {
  const { outPath, pretty, timeoutMs } = parseArgs();

  try {
    await fs.access(outPath);
    throw new Error(`refusing to overwrite existing file: ${outPath}`);
  } catch {
    // ok
  }

  const fetchedAtIso = new Date().toISOString();

  const rootFiles = await listRootXlsxFiles(timeoutMs);
  if (rootFiles.length === 0) throw new Error("mendeley: no root .xlsx files found");

  const allRows = [];
  for (const f of rootFiles) {
    const buf = await fetchBuffer(f.downloadUrl, timeoutMs);
    const rows = loadRowsFromXlsxBuffer(buf);
    allRows.push(...rows);
  }

  const groups = new Map();
  const getGroup = (k, meta) => {
    const existing = groups.get(k);
    if (existing) return existing;
    const created = {
      meta,
      byBitrate: {
        vmaf: new Map(),
        ssim: new Map(),
      },
    };
    groups.set(k, created);
    return created;
  };

  for (const r of allRows) {
    const parsed = parseSequenceName(r.name);
    if (!parsed) continue;

    const groupKey = `${parsed.codec}|${parsed.scene}|${parsed.width}x${parsed.height}|pl=${parsed.packetLossPct}`;
    const meta = parsed;
    const g = getGroup(groupKey, meta);

    const push = (bucket, bitrateKbps, value) => {
      if (!Number.isFinite(value)) return;
      const arr = bucket.get(bitrateKbps);
      if (arr) arr.push(value);
      else bucket.set(bitrateKbps, [value]);
    };

    push(g.byBitrate.vmaf, parsed.bitrateKbps, r.vmaf);
    push(g.byBitrate.ssim, parsed.bitrateKbps, r.ssim);
  }

  const datasets = [];
  const addDataset = (set, metric, key, label, points) => datasets.push({ set, metric, key, label, points });

  for (const { meta, byBitrate } of groups.values()) {
    const bitrates = Array.from(byBitrate.vmaf.keys())
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    if (bitrates.length < 2) continue;

    const pointsByMetric = { vmaf: [], ssim: [] };
    for (const br of bitrates) {
      const v = median(byBitrate.vmaf.get(br) ?? []);
      if (Number.isFinite(v)) pointsByMetric.vmaf.push({ x: br, y: v, w: (byBitrate.vmaf.get(br) ?? []).length });
      const s = median(byBitrate.ssim.get(br) ?? []);
      if (Number.isFinite(s)) pointsByMetric.ssim.push({ x: br, y: s, w: (byBitrate.ssim.get(br) ?? []).length });
    }

    for (const [metric, pts] of Object.entries(pointsByMetric)) {
      pts.sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;

      const monotone = enforceMonotone(pts);
      const clampY = (y) => (metric === "vmaf" ? clamp(y, 0, 100) : clamp(y, 0, 1));
      const points = monotone.map((p) => ({ x: round3(p.x), y: round3(clampY(p.y)) }));

      const resKey = `${meta.width}x${meta.height}`;
      const lossKey = String(meta.packetLossPct).replace(".", "_");
      const stable = `${DATASET_ID}|${DATASET_VERSION}|${meta.codec}|${meta.scene}|${resKey}|${lossKey}|${metric}`;
      const key = `md35735_${meta.codec}_${resKey}_${lossKey}_${slugify(meta.scene)}_${sha1_8(stable)}`;
      const lossLabel = meta.packetLossPct ? `loss=${meta.packetLossPct}%` : "loss=0%";
      const label = `Mendeley 35735kfjnm ${meta.codec} ${meta.scene} ${resKey} ${lossLabel} (${metric} median)`;

      addDataset(1, metric, key, label, points);
      addDataset(2, metric, key, label, points);
    }
  }

  const snapshot = {
    source: {
      homepageUrl: `https://${MENDELEY_HOST}/datasets/${DATASET_ID}/${DATASET_VERSION}`,
      dataUrl: `https://${MENDELEY_HOST}/public-api/datasets/${DATASET_ID}/files?folder_id=root&version=${DATASET_VERSION}`,
      title: "Mendeley Data 10.17632/35735kfjnm.1 (derived curves; CC BY 4.0)",
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
      `xlsx_files: ${rootFiles.length}`,
      `rows: ${allRows.length}`,
      `datasets: ${datasets.length} (unique keys=${new Set(datasets.map((d) => d.key)).size})`,
    ].join("\n") + "\n",
  );
};

await main();
