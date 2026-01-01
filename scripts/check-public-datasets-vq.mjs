#!/usr/bin/env node
/**
 * Verifies accessibility + basic suitability of public video-quality datasets for vq_results expansion.
 *
 * Non-goals:
 * - Downloading large assets (only small range requests)
 * - Training anything
 */

const DEFAULT_TIMEOUT_MS = 60_000;

const usage = () => {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/check-public-datasets-vq.mjs [--timeout-ms <ms>]",
      "",
      "Options:",
      "  --timeout-ms <ms>  Per-request timeout (default 60000)",
      "",
    ].join("\n") + "\n",
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
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
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) {
    throw new Error(`invalid --timeout-ms: ${out.timeoutMs}`);
  }
  return out;
};

const DATASETS = [
  {
    id: "avt-vqdb-uhd-1",
    name: "AVT-VQDB-UHD-1 (TU Ilmenau)",
    expectedUsable: true,
    checks: [
      {
        kind: "csvHeader",
        url: "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1/master/test_1/metadata.csv",
        requiredColumns: [
          "src",
          "video_name",
          "video_target_bitrate",
          "video_height",
          "video_width",
          "video_frame_rate",
          "video_codec",
        ],
      },
      {
        kind: "csvHeader",
        url: "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1/master/test_1/objective_scores.csv",
        requiredColumns: ["src", "video_name", "video_target_bitrate", "vmaf_score"],
      },
      {
        kind: "segmentRange",
        baseUrl: "https://avtshare01.rz.tu-ilmenau.de/avt-vqdb-uhd-1/",
        manifestUrl:
          "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1/master/test_1.json",
      },
    ],
  },
  {
    id: "avt-vqdb-uhd-1-hdr",
    name: "AVT-VQDB-UHD-1-HDR (TU Ilmenau)",
    expectedUsable: true,
    checks: [
      {
        kind: "textContains",
        url: "https://avtshare01.rz.tu-ilmenau.de/avt-vqdb-uhd-1-hdr/objective_scores/vmaf_scores/",
        requiredSubstrings: [".json"],
        byteLimit: 64_000,
      },
      {
        kind: "textContains",
        url: "https://avtshare01.rz.tu-ilmenau.de/avt-vqdb-uhd-1-hdr/objective_scores/vmaf_scores/1280_720_500K_av1_Center_Panorama.json",
        requiredSubstrings: ['"frames"', '"vmaf"'],
        byteLimit: 64_000,
      },
    ],
  },
  {
    id: "avt-vqdb-uhd-1-appeal",
    name: "AVT-VQDB-UHD-1-Appeal (TU Ilmenau)",
    expectedUsable: true,
    checks: [
      {
        kind: "httpOk",
        url: "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-Appeal/main/README.md",
      },
      {
        kind: "textContains",
        url: "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-Appeal/main/README.md",
        requiredSubstrings: ["vmaf_scores"],
      },
      {
        kind: "textContains",
        url: "https://raw.githubusercontent.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1-Appeal/main/vmaf_scores/BunnyAnimation_1000k_1080_av1.json",
        requiredSubstrings: ['"frames"', '"vmaf"'],
        byteLimit: 64_000,
      },
    ],
  },
  {
    id: "xiph-awcy",
    name: "Xiph AWCY (arewecompressedyet.com)",
    expectedUsable: true,
    checks: [
      {
        kind: "httpOk",
        url: "https://arewecompressedyet.com/list.json",
      },
      {
        kind: "textContains",
        url: "https://arewecompressedyet.com/list.json",
        requiredSubstrings: ["run_id", "tasks"],
        byteLimit: 64_000,
      },
      {
        kind: "textContains",
        url: "https://arewecompressedyet.com/runs/x264-medium@2022-10-31T21:19:39.857Z/csv_export.csv",
        requiredSubstrings: ["Bitrate(kbps)", "VMAF_Y", "SSIM_Y(dB)"],
        byteLimit: 64_000,
      },
    ],
  },
  {
    id: "dash-features-quality-figshare",
    name: "Features+Quality metrics for video coding in DASH (Figshare collection)",
    expectedUsable: true,
    checks: [
      {
        kind: "textContains",
        url: "https://raw.githubusercontent.com/cloudmedialab-uv/VideoCodingFeaturesQualityDataset/main/README.md",
        requiredSubstrings: ["figshare", "10.6084/m9.figshare.c.6764328.v1"],
      },
      {
        kind: "csvHeader",
        url: "https://springernature.figshare.com/ndownloader/files/41742810",
        headers: { "User-Agent": "Mozilla/5.0" },
        requiredColumns: ["file", "chunk", "crf", "res", "vmafmean", "psnrmean", "ssimmean"],
      },
    ],
  },
  {
    id: "mendeley-35735kfjnm",
    name: "Mendeley Data 10.17632/35735kfjnm.1 (objective+subjective tables)",
    expectedUsable: true,
    checks: [
      {
        kind: "httpOk",
        url: "https://data.mendeley.com/datasets/35735kfjnm/1",
        headers: { "User-Agent": "Mozilla/5.0" },
      },
      {
        kind: "mendeleyRootDownloadProbe",
        datasetId: "35735kfjnm",
        version: 1,
        folderId: "root",
      },
    ],
  },
  {
    id: "netflix-vmaf-nflx-public",
    name: "Netflix VMAF NFLX Public Dataset",
    expectedUsable: false,
    checks: [
      {
        kind: "textContains",
        url: "https://raw.githubusercontent.com/Netflix/vmaf/master/resource/doc/datasets.md",
        requiredSubstrings: ["please request for access"],
      },
      {
        kind: "httpRedirectChainContains",
        url: "https://drive.google.com/folderview?id=0B3YWNICYMBIweGdJbERlUG9zc0k&usp=sharing",
        mustContain: ["accounts.google.com"],
        maxHops: 5,
      },
    ],
  },
  {
    id: "msu-cvqad",
    name: "MSU CVQAD (open part of MSU VQM benchmark)",
    expectedUsable: false,
    checks: [
      {
        kind: "textContains",
        url: "https://videoprocessing.ai/datasets/cvqad.html",
        requiredSubstrings: ["fill-in the request form"],
      },
    ],
  },
  {
    id: "mcl-jcv-hf",
    name: "MCL-JCV Dataset (Hugging Face: uscmcl/MCL-JCV_Dataset)",
    expectedUsable: false,
    checks: [
      {
        kind: "httpJson",
        url: "https://huggingface.co/api/datasets/uscmcl/MCL-JCV_Dataset",
        requiredJson: { gated: false, private: false },
      },
      {
        kind: "httpOk",
        url: "https://huggingface.co/datasets/uscmcl/MCL-JCV_Dataset/resolve/main/README.md?download=1",
      },
      {
        kind: "hfTreeSummary",
        url: "https://huggingface.co/api/datasets/uscmcl/MCL-JCV_Dataset/tree/main?recursive=1",
      },
    ],
  },
  {
    id: "bvi-cc-bristol",
    name: "BVI-CC (University of Bristol data.bris.uk)",
    expectedUsable: true,
    checks: [
      {
        kind: "httpOk",
        url: "https://data.bris.ac.uk/data/dataset/1fyr4uv4aqo352lct09g7r9ejp",
      },
      {
        kind: "rangeSizeProbe",
        url: "https://data.bris.ac.uk/datasets/tar/1fyr4uv4aqo352lct09g7r9ejp.zip",
      },
      {
        kind: "rangeSizeProbe",
        url: "https://vilab.blogs.bristol.ac.uk/files/2020/03/BVI-CC_SUBDATA.zip",
      },
    ],
  },
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

let timeoutMs = DEFAULT_TIMEOUT_MS;

async function fetchWithTimeout(url, init = {}) {
  const attempt = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal, redirect: init.redirect ?? "follow" });
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
}

async function fetchTextPrefix(url, byteLimit = 16_384, headers = {}) {
  const res = await fetchWithTimeout(url, { headers: { ...headers, Range: `bytes=0-${byteLimit - 1}` } });
  const body = await res.text();
  return { res, body };
}

function parseCsvHeaderLine(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  // good enough for header detection; AVT files are plain (no quoted commas in header)
  return firstLine
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runCheck(check) {
  switch (check.kind) {
    case "httpOk": {
      const res = await fetchWithTimeout(check.url, { headers: { ...(check.headers ?? {}), Range: "bytes=0-0" } });
      return {
        ok: res.status >= 200 && res.status < 400,
        evidence: [`${check.url} -> HTTP ${res.status}`],
      };
    }
    case "csvHeader": {
      const { res, body } = await fetchTextPrefix(check.url, 16_384, check.headers ?? {});
      const cols = parseCsvHeaderLine(body);
      const missing = check.requiredColumns.filter((c) => !cols.includes(c));
      return {
        ok: res.ok && missing.length === 0,
        evidence: [
          `${check.url} -> HTTP ${res.status}`,
          `columns: ${cols.slice(0, 20).join(", ")}${cols.length > 20 ? " ..." : ""}`,
          missing.length ? `missing: ${missing.join(", ")}` : "missing: (none)",
        ],
      };
    }
    case "jsonArraySample": {
      const { res, body } = await fetchTextPrefix(check.url, 64_000, check.headers ?? {});
      let json;
      try {
        json = JSON.parse(body);
      } catch (e) {
        return {
          ok: false,
          evidence: [`${check.url} -> HTTP ${res.status}`, `JSON parse failed: ${String(e)}`],
        };
      }
      if (!Array.isArray(json)) {
        return {
          ok: false,
          evidence: [`${check.url} -> HTTP ${res.status}`, `expected JSON array, got ${typeof json}`],
        };
      }
      const found = json.find((v) => check.samplePredicate(v));
      return {
        ok: res.ok && Boolean(found),
        evidence: [
          `${check.url} -> HTTP ${res.status}`,
          `array length: ${json.length}`,
          `sample match: ${found ? String(found) : "(none)"}`,
        ],
        data: { sample: found ?? null },
      };
    }
    case "segmentRange": {
      const { res, body } = await fetchTextPrefix(check.manifestUrl, 64_000, check.headers ?? {});
      let json;
      try {
        json = JSON.parse(body);
      } catch (e) {
        return {
          ok: false,
          evidence: [`${check.manifestUrl} -> HTTP ${res.status}`, `JSON parse failed: ${String(e)}`],
        };
      }
      const first = Array.isArray(json) ? json.find((x) => typeof x === "string") : null;
      if (!first) {
        return { ok: false, evidence: ["manifest contains no string entries"] };
      }
      const url = new URL(first, check.baseUrl).toString();
      const segRes = await fetchWithTimeout(url, { headers: { ...(check.headers ?? {}), Range: "bytes=0-0" } });
      const contentType = segRes.headers.get("content-type") ?? "unknown";
      return {
        ok: segRes.status >= 200 && segRes.status < 400,
        evidence: [`${url} -> HTTP ${segRes.status} (${contentType})`],
      };
    }
    case "textContains": {
      const { res, body } = await fetchTextPrefix(check.url, check.byteLimit ?? 128_000, check.headers ?? {});
      const missing = check.requiredSubstrings.filter((s) => !body.includes(s));
      return {
        ok: res.ok && missing.length === 0,
        evidence: [
          `${check.url} -> HTTP ${res.status}`,
          missing.length ? `missing substrings: ${missing.join(" | ")}` : "missing substrings: (none)",
        ],
      };
    }
    case "httpRedirectChainContains": {
      const visited = [];
      let current = check.url;
      for (let hop = 0; hop < check.maxHops; hop += 1) {
        const res = await fetchWithTimeout(current, { redirect: "manual" });
        visited.push(`${current} -> ${res.status}`);
        const location = res.headers.get("location");
        if (location && res.status >= 300 && res.status < 400) {
          current = new URL(location, current).toString();
          continue;
        }
        // reached final
        break;
      }
      const ok = check.mustContain.every((needle) => visited.join("\n").includes(needle));
      return { ok, evidence: visited };
    }
    case "httpJson": {
      const res = await fetchWithTimeout(check.url);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        return { ok: false, evidence: [`${check.url} -> HTTP ${res.status}`, `JSON parse failed: ${String(e)}`] };
      }
      const mismatches = Object.entries(check.requiredJson).flatMap(([k, v]) =>
        json?.[k] === v ? [] : [`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(json?.[k])}`],
      );
      return {
        ok: res.ok && mismatches.length === 0,
        evidence: [`${check.url} -> HTTP ${res.status}`, mismatches.length ? mismatches.join("; ") : "json matches"],
      };
    }
    case "hfTreeSummary": {
      const res = await fetchWithTimeout(check.url);
      const text = await res.text();
      let items;
      try {
        items = JSON.parse(text);
      } catch (e) {
        return { ok: false, evidence: [`${check.url} -> HTTP ${res.status}`, `JSON parse failed: ${String(e)}`] };
      }
      if (!Array.isArray(items)) {
        return { ok: false, evidence: [`expected array, got ${typeof items}`] };
      }
      const total = items.length;
      const lfsCount = items.filter((x) => x && typeof x === "object" && x.lfs).length;
      const maxSize = items.reduce((m, x) => Math.max(m, Number(x?.size ?? 0)), 0);
      const sample = items
        .filter((x) => x?.type === "file")
        .slice(0, 5)
        .map((x) => `${x.path} (${formatBytes(Number(x.size ?? 0))}${x.lfs ? ", LFS" : ""})`);
      return {
        ok: res.ok && total > 0,
        evidence: [
          `${check.url} -> HTTP ${res.status}`,
          `items: ${total}, lfs: ${lfsCount}, maxSize: ${formatBytes(maxSize)}`,
          `sample: ${sample.join(" | ")}`,
        ],
      };
    }
    case "rangeSizeProbe": {
      const res = await fetchWithTimeout(check.url, { headers: { Range: "bytes=0-0" } });
      const contentRange = res.headers.get("content-range") ?? "";
      const match = contentRange.match(/\/(\d+)$/);
      const size = match ? Number(match[1]) : null;
      const ct = res.headers.get("content-type") ?? "unknown";
      const ok = res.status === 206 && Number.isFinite(size);
      return {
        ok,
        evidence: [
          `${check.url} -> HTTP ${res.status} (${ct})`,
          `content-range: ${contentRange || "(missing)"}`,
          `size: ${size == null ? "unknown" : formatBytes(size)} (${size ?? "?"} bytes)`,
        ],
        data: { sizeBytes: size },
      };
    }
    case "mendeleyRootDownloadProbe": {
      const listUrl = `https://data.mendeley.com/public-api/datasets/${encodeURIComponent(
        check.datasetId,
      )}/files?folder_id=${encodeURIComponent(check.folderId)}&version=${encodeURIComponent(check.version)}`;
      const listRes = await fetchWithTimeout(listUrl, {
        headers: { Accept: "application/vnd.mendeley-public-dataset.1+json", "User-Agent": "Mozilla/5.0" },
      });
      const listText = await listRes.text();
      let list;
      try {
        list = JSON.parse(listText);
      } catch (e) {
        return { ok: false, evidence: [`${listUrl} -> HTTP ${listRes.status}`, `JSON parse failed: ${String(e)}`] };
      }
      if (!Array.isArray(list)) {
        return { ok: false, evidence: [`${listUrl} -> HTTP ${listRes.status}`, `expected array, got ${typeof list}`] };
      }
      const xlsx = list.find(
        (f) =>
          String(f?.filename ?? "")
            .toLowerCase()
            .endsWith(".xlsx") && f?.content_details,
      );
      const downloadUrl = String(xlsx?.content_details?.download_url ?? "");
      if (!downloadUrl) {
        return { ok: false, evidence: [`${listUrl} -> HTTP ${listRes.status}`, "no .xlsx download_url found"] };
      }
      const dlRes = await fetchWithTimeout(downloadUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": "Mozilla/5.0" },
      });
      const ct = dlRes.headers.get("content-type") ?? "unknown";
      return {
        ok: listRes.ok && dlRes.status >= 200 && dlRes.status < 400,
        evidence: [
          `${listUrl} -> HTTP ${listRes.status} (items=${list.length})`,
          `sample: ${String(xlsx?.filename ?? "(unknown)")}`,
          `${downloadUrl} -> HTTP ${dlRes.status} (${ct})`,
        ],
      };
    }
    default:
      return { ok: false, evidence: [`unknown check kind: ${check.kind}`] };
  }
}

async function main() {
  const args = parseArgs();
  timeoutMs = args.timeoutMs;

  const results = [];
  for (const dataset of DATASETS) {
    const datasetResult = { id: dataset.id, name: dataset.name, expectedUsable: dataset.expectedUsable, checks: [] };
    for (const check of dataset.checks) {
      try {
        const r = await runCheck(check);
        datasetResult.checks.push({ kind: check.kind, ok: r.ok, evidence: r.evidence, data: r.data ?? null });
      } catch (e) {
        datasetResult.checks.push({ kind: check.kind, ok: false, evidence: [String(e)], data: null });
      }
    }
    results.push(datasetResult);
  }

  const failures = [];
  for (const dataset of results) {
    const ok = dataset.checks.every((c) => c.ok);
    if (dataset.expectedUsable && !ok) failures.push(dataset.id);
  }

  const payload = { ok: failures.length === 0, failures, results };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = payload.ok ? 0 : 1;
}

await main();
