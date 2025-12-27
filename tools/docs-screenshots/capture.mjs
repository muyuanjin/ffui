import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const printHelp = () => {
  // Keep this lightweight: no external arg parser dependency.
  const lines = [
    "FFUI docs screenshots",
    "",
    "Usage:",
    "  pnpm run docs:screenshots -- --media-dir <DIR> [options]",
    "  node tools/docs-screenshots/capture.mjs --media-dir <DIR> [options]",
    "",
    "Required:",
    "  --media-dir <DIR>                 Folder containing real media files (videos, optional posters).",
    "",
    "Options:",
    "  --width <PX>                      Output image width (default: 1920).",
    "  --height <PX>                     Output image height (default: 1080).",
    "  --device-scale-factor <N>         Playwright deviceScaleFactor (default: 1).",
    "  --monitor-capture-height <PX>     Monitor panel capture viewport height (default: height+40).",
    "  --settings-capture-height <PX>    Settings panel capture viewport height (default: height).",
    "  --ui-font-name <NAME>            Force a UI font name (recommended for consistent EN/ZH sizing).",
    "  --allow-video-thumbs              Generate preview posters from video frames when no images exist.",
    "  --thumb-time <HH:MM:SS>           Frame timestamp for thumbnails (default: 00:05:00).",
    "  --compare-thumb-time <HH:MM:SS>   Frame timestamp used for compare screenshots/GIF (default: --thumb-time).",
    "  --compare-format <FMT>            Compare output format: gif or webp (default: gif).",
    "  --shots <LIST>                    Comma-separated outBase list to capture (e.g. main,compare).",
    "  --ui-scale <PERCENT>              UI scale percent (80-140, default: 100).",
    "  --ui-font-size-px <PX>            Base font size in px (e.g. 18/20/22).",
    "  --ui-font-size-percent <PERCENT>  Base font size percent (80-140).",
    "  --port <PORT>                     Dev server port start (default: 5173).",
    "  -h, --help                        Show help.",
    "",
    "Notes:",
    "  - If both --ui-font-size-px and --ui-font-size-percent are set, percent wins.",
    "  - Use --settings-capture-height to control how tall the Settings screenshot is.",
    "  - Use --width/--height to change the exported .webp resolution (all panels).",
    "  - If screenshots look soft, prefer --device-scale-factor 1 (avoids downscaling text).",
    '  - For consistent EN/ZH layout on text-heavy pages, use --ui-font-name (e.g. "Microsoft YaHei UI").',
    "  - The script overwrites docs/images/*-{en,zh-CN}.webp.",
    "  - PowerShell tip: avoid `--%` here; use the `--` separator (or call `node ...` directly).",
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
};

const parseArgs = (argv) => {
  const args = {
    help: false,
    mediaDir: null,
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    monitorCaptureHeight: null,
    settingsCaptureHeight: null,
    uiFontName: null,
    allowVideoThumbs: false,
    thumbTime: "00:05:00",
    compareThumbTime: null,
    compareFormat: "gif",
    shots: null,
    uiScalePercent: 100,
    uiFontSizePx: null,
    uiFontSizePercent: null,
    port: 5173,
  };

  const takeValue = (i, key) => {
    const v = argv[i + 1];
    if (v == null) throw new Error(`Missing value for ${key}`);
    return v;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.help = true;
      continue;
    }
    if (a === "--media-dir") {
      args.mediaDir = takeValue(i, a);
      i += 1;
      continue;
    }
    if (a === "--width") {
      args.width = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--height") {
      args.height = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--device-scale-factor") {
      args.deviceScaleFactor = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--monitor-capture-height") {
      args.monitorCaptureHeight = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--settings-capture-height") {
      args.settingsCaptureHeight = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--ui-font-name") {
      args.uiFontName = String(takeValue(i, a)).trim() || null;
      i += 1;
      continue;
    }
    if (a === "--allow-video-thumbs") {
      args.allowVideoThumbs = true;
      continue;
    }
    if (a === "--thumb-time") {
      args.thumbTime = takeValue(i, a);
      i += 1;
      continue;
    }
    if (a === "--compare-thumb-time") {
      args.compareThumbTime = takeValue(i, a);
      i += 1;
      continue;
    }
    if (a === "--compare-format") {
      const raw = String(takeValue(i, a)).trim().toLowerCase();
      if (raw !== "gif" && raw !== "webp") {
        throw new Error(`Invalid --compare-format: ${raw} (expected gif|webp)`);
      }
      args.compareFormat = raw;
      i += 1;
      continue;
    }
    if (a === "--shots") {
      const raw = String(takeValue(i, a));
      args.shots = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (a === "--ui-scale") {
      args.uiScalePercent = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--ui-font-size-px") {
      args.uiFontSizePx = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--ui-font-size-percent") {
      args.uiFontSizePercent = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a === "--port") {
      args.port = Number(takeValue(i, a));
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return args;
};

const resolveCliArgv = () => {
  const direct = process.argv.slice(2);
  if (direct.length > 0) return direct;

  const rawNpmArgv = process.env.npm_config_argv;
  if (!rawNpmArgv) return direct;

  try {
    const parsed = JSON.parse(rawNpmArgv);
    const original = Array.isArray(parsed?.original) ? parsed.original : null;
    if (!original || original.length === 0) return direct;

    const lastDoubleDash = original.lastIndexOf("--");
    if (lastDoubleDash !== -1) return original.slice(lastDoubleDash + 1);

    const knownOptions = new Set([
      "-h",
      "--help",
      "--media-dir",
      "--allow-video-thumbs",
      "--thumb-time",
      "--compare-thumb-time",
      "--compare-format",
      "--shots",
      "--ui-scale",
      "--ui-font-size-px",
      "--ui-font-size-percent",
      "--port",
    ]);
    const firstKnown = original.findIndex((a) => knownOptions.has(a));
    if (firstKnown !== -1) return original.slice(firstKnown);
  } catch {
    // Ignore: fall back to empty argv.
  }

  return direct;
};

const docsImagesDir = path.join(repoRoot, "docs", "images");
const tmpDir = path.join(docsImagesDir, ".tmp-screenshots");
const tmpPublicDir = path.join(repoRoot, "public", "docs-screenshots", "__local_tmp");

const SHOTS_MAIN = [
  { tab: "queue", panelTestId: "queue-panel", outBase: "main", readyTestId: "queue-item-card" },
  {
    tab: "queue",
    panelTestId: "queue-panel",
    outBase: "compare",
    readyTestId: "queue-item-card",
    mode: "job-compare-wipe",
    settleMs: 450,
  },
  { tab: "presets", panelTestId: "preset-panel", outBase: "preset", readyText: "Universal 1080p" },
];

const SHOT_ONBOARDING = {
  tab: "presets",
  panelTestId: "preset-panel",
  outBase: "onboarding",
  readyTestId: "preset-import-recommended-pack",
  mode: "preset-setup-wizard",
};

// Capture the monitor panel with a slightly taller viewport, then scale down to
// 1920x1080 so the bottom widgets are visible without changing the published
// image size.
const SHOT_MONITOR = {
  tab: "monitor",
  panelTestId: "monitor-panel",
  outBase: "monitor",
  targetSize: { width: 1920, height: 1080 },
  readyText: "CPU / MEMORY / GPU",
};

const SETTINGS_SHOT = {
  tab: "settings",
  panelTestId: "settings-panel",
  outBase: "settings",
  readySelector: '[data-testid="external-tools-mode-auto-managed"]',
};

const LOCALES = [
  { value: "en", suffix: "en" },
  { value: "zh-CN", suffix: "zh-CN" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });

const fileExists = async (p) => {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
};

const dirExists = async (p) => {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
};

const findOpenPort = async (startPort) => {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => resolve(true));
      });
    });

  for (let port = startPort; port < startPort + 50; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryPort(port);
    if (ok) return port;
  }
  throw new Error(`Could not find an open port starting at ${startPort}`);
};

const isExt = (filePath, exts) => {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
};

const walkFiles = async (rootDir, options = {}) => {
  const maxFiles = options.maxFiles ?? 3000;
  const maxDepth = options.maxDepth ?? 3;

  const results = [];
  const queue = [{ dir: rootDir, depth: 0 }];

  while (queue.length && results.length < maxFiles) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        results.push(full);
      } else if (entry.isDirectory() && depth < maxDepth) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }

  return results;
};

const ensureDir = async (dir) => {
  await mkdir(dir, { recursive: true });
};

const _convertPngToWebp = async (pngPath, webpPath, targetSize) => {
  const targetWidth = Number(targetSize?.width ?? 0);
  const targetHeight = Number(targetSize?.height ?? 0);
  const hasTarget =
    Number.isFinite(targetWidth) && Number.isFinite(targetHeight) && targetWidth > 0 && targetHeight > 0;
  const vf = hasTarget ? `scale=${targetWidth}:${targetHeight}:flags=lanczos` : null;

  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      pngPath,
      ...(vf ? ["-vf", vf] : []),
      "-c:v",
      "libwebp",
      "-lossless",
      "1",
      "-compression_level",
      "6",
      webpPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
};

const convertPngToWebpWithViewport = async ({ pngPath, webpPath, viewport, targetSize, deviceScaleFactor }) => {
  const dsf =
    Number.isFinite(Number(deviceScaleFactor)) && Number(deviceScaleFactor) > 0 ? Number(deviceScaleFactor) : 1;
  const captureW = Math.round(Number(viewport?.width ?? 0) * dsf);
  const captureH = Math.round(Number(viewport?.height ?? 0) * dsf);
  const outW = Math.round(Number(targetSize?.width ?? 0));
  const outH = Math.round(Number(targetSize?.height ?? 0));

  let vf = null;
  const hasTarget = Number.isFinite(outW) && Number.isFinite(outH) && outW > 0 && outH > 0;

  if (hasTarget) {
    // Prefer cropping over scaling when the viewport is only taller than the
    // published output. Cropping preserves font sharpness.
    if (Number.isFinite(captureW) && Number.isFinite(captureH) && captureW > 0 && captureH > 0) {
      const cropW = Math.min(captureW, outW);
      const cropH = Math.min(captureH, outH);

      if (captureW === outW && captureH >= outH) {
        // Keep the bottom area visible by cropping from the top.
        const y = Math.max(0, captureH - outH);
        vf = `crop=${outW}:${outH}:0:${y}`;
      } else if (captureW === outW && captureH === outH && dsf === 1) {
        vf = null; // exact match, no resampling
      } else if (cropW === outW && cropH === outH && dsf === 1) {
        vf = null;
      } else {
        const inAspect = captureW / captureH;
        const outAspect = outW / outH;
        const aspectDiff = Math.abs(inAspect - outAspect);

        if (Number.isFinite(aspectDiff) && aspectDiff < 0.001) {
          // Same aspect ratio: a simple resample is fine.
          vf = `scale=${outW}:${outH}:flags=lanczos`;
        } else {
          // Different aspect ratio: never stretch. Scale to cover then crop.
          // This matches what a "natural window resize" feels like more than
          // letterboxing/padding, while keeping text sharp.
          vf = `scale=${outW}:${outH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${outH}`;
        }
      }
    } else {
      vf = `scale=${outW}:${outH}:flags=lanczos`;
    }
  }

  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      pngPath,
      ...(vf ? ["-vf", vf] : []),
      "-c:v",
      "libwebp",
      "-lossless",
      "1",
      "-compression_level",
      "6",
      webpPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
};

const applyDocsScreenshotStyles = async (page) => {
  const css = `
    .ffui-ui-scale-root {
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgb(2, 6, 23);
    }
    [data-testid="ffui-action-batch-compress"] {
      display: none !important;
    }
  `;
  await page.addStyleTag({ content: css });
};

const quoteCssFontFamilyName = (name) => {
  if (/^[a-z0-9_-]+$/i.test(name)) return name;
  return `"${String(name).replace(/"/g, '\\"')}"`;
};

const forceUiAppearance = async (page, options) => {
  const uiScalePercent = Number(options?.uiScalePercent ?? 100);
  const uiFontSizePercent = Number(options?.uiFontSizePercent ?? 100);
  const uiFontName = typeof options?.uiFontName === "string" ? options.uiFontName.trim() : "";
  const fontStack = uiFontName
    ? `${quoteCssFontFamilyName(uiFontName)}, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif`
    : "";
  await page.evaluate(
    ({ uiScalePercent: s, uiFontSizePercent: f, fontStack: stack }) => {
      const scale = s / 100;
      const inv = scale > 0 ? 1 / scale : 1;
      document.documentElement.style.setProperty("--ffui-ui-scale", String(scale));
      document.documentElement.style.setProperty("--ffui-ui-scale-inv", String(inv));
      document.documentElement.style.setProperty("--ffui-ui-font-size-scale", String(f / 100));
      document.documentElement.style.fontSize = `${(16 * f) / 100}px`;
      if (stack) {
        document.documentElement.style.setProperty("--ffui-ui-font-family", stack);
        if (document.body) document.body.style.fontFamily = stack;
      }
      document.documentElement.dataset.ffuiUiScaleEngine = "transform";
      document.documentElement.dataset.ffuiUiScale = String(s);
      document.documentElement.dataset.ffuiUiFontSizePercent = String(f);
    },
    { uiScalePercent, uiFontSizePercent, fontStack },
  );
};

const waitForLocaleApplied = async (page, locale) => {
  const expected = locale.value === "en" ? "Transcode Queue" : "任务队列";
  await page.waitForFunction(
    ({ testId, expectedText }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return (el?.textContent ?? "").trim() === expectedText;
    },
    { testId: "ffui-sidebar-active-title", expectedText: expected },
  );
};

const ensureLocaleSelected = async (page, locale) => {
  const itemTestId = locale.value === "en" ? "ffui-locale-en" : "ffui-locale-zh-CN";
  try {
    await page.getByTestId("ffui-locale-trigger").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("ffui-locale-trigger").click();
    await page.getByTestId(itemTestId).click();
  } catch {
    // Best-effort: if the select isn't available (or already set), rely on query params / defaults.
  }
};

const applyStablePreferences = async (context) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("ffui.queueViewMode", "detail");
      window.localStorage.setItem("ffui.queueProgressStyle", "bar");
      window.localStorage.setItem("ffui.queueMode", "display");
      window.localStorage.setItem("ffui.presetsViewMode", "grid");
    } catch {
      // Ignore.
    }
  });
};

const clampInt = (n, min, max, fallback) => {
  const raw = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  return Math.min(max, Math.max(min, rounded));
};

const resolveUiScalePercent = (args) => clampInt(args.uiScalePercent, 80, 140, 100);

const resolveOutputSize = (args) => {
  const width = clampInt(args.width, 1024, 4096, 1920);
  const height = clampInt(args.height, 720, 2160, 1080);
  return { width, height };
};

const resolveCaptureHeight = (value, fallback, min) => {
  const raw = value == null ? null : Number(value);
  if (raw == null || !Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  return Math.max(min, Math.min(4096, rounded));
};

const resolveUiFontSizePercent = (args) => {
  if (args.uiFontSizePercent != null) {
    return clampInt(args.uiFontSizePercent, 80, 140, 113);
  }
  if (args.uiFontSizePx != null) {
    const p = Math.round((Number(args.uiFontSizePx) / 16) * 100);
    return clampInt(p, 80, 140, 113);
  }
  return 113; // 18px option => round(px/16*100) = 113
};

const scorePoster = (filePath) => {
  const name = path.basename(filePath).toLowerCase();
  let score = 0;
  if (name.includes("poster")) score += 50;
  if (name.includes("cover")) score += 40;
  if (name.includes("folder")) score += 35;
  if (name.includes("season")) score += 25;
  if (name.includes("fanart")) score += 20;
  if (name.includes("thumb")) score += 15;
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) score += 5;
  if (name.endsWith(".png")) score += 3;
  if (name.endsWith(".webp")) score += 2;
  return score;
};

const prepareLocalMedia = async (args) => {
  const mediaDir = args.mediaDir;
  if (!mediaDir) throw new Error("Missing required --media-dir <DIR>");
  const allowVideoThumbs = args.allowVideoThumbs === true;
  const thumbTime = args.thumbTime || "00:05:00";
  const compareThumbTime = args.compareThumbTime || thumbTime || "00:05:00";

  if (!(await dirExists(mediaDir))) {
    throw new Error(`Docs media directory not found: ${mediaDir}`);
  }

  const all = await walkFiles(mediaDir, { maxFiles: 4000, maxDepth: 4 });
  const imageExts = [".jpg", ".jpeg", ".png", ".webp"];
  const videoExts = [".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts"];

  const images = all.filter((p) => isExt(p, imageExts));
  const videos = all.filter((p) => isExt(p, videoExts));

  if (videos.length < 1) {
    throw new Error(`No video files found under: ${mediaDir}`);
  }

  const pickedVideos = videos
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 3);

  await mkdir(tmpPublicDir, { recursive: true });

  const posterUrls = [];
  if (images.length >= 1) {
    const pickedImages = images
      .slice()
      .sort((a, b) => scorePoster(b) - scorePoster(a) || a.localeCompare(b))
      .slice(0, 3);

    for (let i = 0; i < Math.min(3, pickedImages.length); i += 1) {
      const src = pickedImages[i];
      const ext = path.extname(src).toLowerCase() || ".jpg";
      const dstName = `poster-${i + 1}${ext}`;
      const dst = path.join(tmpPublicDir, dstName);
      // eslint-disable-next-line no-await-in-loop
      await copyFile(src, dst);
      posterUrls.push(`/docs-screenshots/__local_tmp/${dstName}`);
    }
  } else if (allowVideoThumbs) {
    console.warn(
      `[docs:screenshots] No poster images found under ${mediaDir}; generating thumbnails from video frames (FFUI_DOCS_ALLOW_VIDEO_THUMBS=1).`,
    );

    for (let i = 0; i < Math.min(3, pickedVideos.length); i += 1) {
      const videoPath = pickedVideos[i];
      const dstName = `poster-${i + 1}.jpg`;
      const dst = path.join(tmpPublicDir, dstName);
      try {
        // eslint-disable-next-line no-await-in-loop
        await run(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            thumbTime,
            "-i",
            videoPath,
            "-frames:v",
            "1",
            "-vf",
            "scale=1280:-1:flags=lanczos",
            dst,
          ],
          { cwd: repoRoot, stdio: "inherit" },
        );
      } catch (error) {
        console.warn(`[docs:screenshots] Failed to extract thumbnail at ${thumbTime}; retrying at 00:00:30`, error);
        // eslint-disable-next-line no-await-in-loop
        await run(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "00:00:30",
            "-i",
            videoPath,
            "-frames:v",
            "1",
            "-vf",
            "scale=1280:-1:flags=lanczos",
            dst,
          ],
          { cwd: repoRoot, stdio: "inherit" },
        );
      }
      posterUrls.push(`/docs-screenshots/__local_tmp/${dstName}`);
    }
  } else {
    throw new Error(
      `No poster image files found under: ${mediaDir} (expected .jpg/.png/.webp)\n` +
        `Either add poster files to that folder, or set FFUI_DOCS_ALLOW_VIDEO_THUMBS=1 to generate thumbnails from the video files.`,
    );
  }

  while (posterUrls.length < 3) posterUrls.push(posterUrls[posterUrls.length - 1]);

  const compareInputName = "compare-input.jpg";
  const compareOutputName = "compare-output.jpg";
  const compareInputPath = path.join(tmpPublicDir, compareInputName);
  const compareOutputPath = path.join(tmpPublicDir, compareOutputName);

  // Keep docs screenshots fast: extract a short window and let `thumbnail` pick
  // a representative frame (reduces the chance of landing on an awkward cut).
  const extractCompareFrame = async (time) => {
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        time,
        "-t",
        "2",
        "-i",
        pickedVideos[0],
        "-frames:v",
        "1",
        "-vf",
        "fps=12,thumbnail=n=18,scale=1280:-1:flags=lanczos",
        "-q:v",
        "2",
        compareInputPath,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );
  };

  try {
    await extractCompareFrame(compareThumbTime);
  } catch (error) {
    console.warn(
      `[docs:screenshots] Failed to extract compare frame at ${compareThumbTime}; retrying at 00:00:30`,
      error,
    );
    await extractCompareFrame("00:00:30");
  }

  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      compareInputPath,
      "-frames:v",
      "1",
      "-vf",
      // Keep it subtle and colored: the goal is to demonstrate the wipe UX,
      // not to simulate an actual transcoding result.
      "eq=contrast=1.08:brightness=0.02:saturation=1.06,unsharp=3:3:0.45:3:3:0.0",
      "-q:v",
      "2",
      compareOutputPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  return {
    envPatch: {
      // Many UI surfaces are gated behind hasTauri(); force a Tauri-like
      // environment for docs screenshot builds unless the caller overrides it.
      VITE_DOCS_SCREENSHOT_HAS_TAURI: process.env.VITE_DOCS_SCREENSHOT_HAS_TAURI ?? "1",
      VITE_DOCS_SCREENSHOT_UI_SCALE_PERCENT: String(resolveUiScalePercent(args)),
      VITE_DOCS_SCREENSHOT_UI_FONT_SIZE_PERCENT: String(resolveUiFontSizePercent(args)),
      VITE_DOCS_SCREENSHOT_UI_FONT_SIZE_PX: args.uiFontSizePx != null ? String(args.uiFontSizePx) : "",
      VITE_DOCS_SCREENSHOT_UI_FONT_NAME: args.uiFontName != null ? String(args.uiFontName) : "",
      VITE_DOCS_SCREENSHOT_VIDEO_1: pickedVideos[0] ?? "",
      VITE_DOCS_SCREENSHOT_VIDEO_2: pickedVideos[1] ?? pickedVideos[0] ?? "",
      VITE_DOCS_SCREENSHOT_VIDEO_3: pickedVideos[2] ?? pickedVideos[1] ?? pickedVideos[0] ?? "",
      VITE_DOCS_SCREENSHOT_POSTER_1: posterUrls[0] ?? "",
      VITE_DOCS_SCREENSHOT_POSTER_2: posterUrls[1] ?? posterUrls[0] ?? "",
      VITE_DOCS_SCREENSHOT_POSTER_3: posterUrls[2] ?? posterUrls[1] ?? posterUrls[0] ?? "",
      VITE_DOCS_SCREENSHOT_COMPARE_INPUT_FRAME: `/docs-screenshots/__local_tmp/${compareInputName}`,
      VITE_DOCS_SCREENSHOT_COMPARE_OUTPUT_FRAME: `/docs-screenshots/__local_tmp/${compareOutputName}`,
    },
    cleanup: async () => {
      await rm(tmpPublicDir, { recursive: true, force: true });
    },
  };
};

const waitForHttpOk = async (url, timeoutMs) => {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for dev server: ${url}`);
    }
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // Ignore.
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
};

const withDevServer = async (fn, options = {}) => {
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  if (!(await fileExists(viteBin))) {
    throw new Error("Missing Vite binary. Run `pnpm install` first.");
  }

  const port = await findOpenPort(Number(options.port ?? 5173));
  const baseUrl = `http://127.0.0.1:${port}/`;

  const env = {
    ...process.env,
    ...(options.envPatch ?? {}),
    BROWSER: "none",
    LANG: "en_US.UTF-8",
    // Screenshots should reflect a fully-hydrated UI; don't defer startup
    // fetches behind an idle gate.
    VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
  };

  const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");

  const server = spawn(
    process.execPath,
    [viteBin, "--config", configPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    },
  );

  try {
    await waitForHttpOk(baseUrl, 30_000);
    await fn({ baseUrl });
  } finally {
    server.kill("SIGTERM");
    await sleep(250);
    server.kill("SIGKILL");
  }
};

const captureScreenshotsForLocale = async ({
  chromium,
  baseUrl,
  locale,
  viewport,
  shots,
  expectedFontSizePercent,
  expectedUiScalePercent,
  expectedUiFontName,
  deviceScaleFactor,
  compareFormat,
}) => {
  const context = await chromium.newContext({
    viewport,
    deviceScaleFactor,
    locale: locale.value === "en" ? "en-US" : "zh-CN",
  });
  await applyStablePreferences(context);
  const page = await context.newPage();

  const url = `${baseUrl}?ffuiLocale=${encodeURIComponent(locale.value)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 30_000 });
  await applyDocsScreenshotStyles(page);

  await forceUiAppearance(page, {
    uiScalePercent: expectedUiScalePercent,
    uiFontSizePercent: expectedFontSizePercent,
    uiFontName: expectedUiFontName,
  });
  await page.waitForFunction(
    ({ expectedScale, expectedFont }) =>
      document.documentElement?.dataset?.ffuiUiScale === expectedScale &&
      document.documentElement?.dataset?.ffuiUiFontSizePercent === expectedFont,
    { expectedScale: String(expectedUiScalePercent), expectedFont: String(expectedFontSizePercent) },
  );
  if (expectedUiFontName) {
    await page.waitForFunction(
      ({ name }) => {
        const family = getComputedStyle(document.body || document.documentElement).fontFamily || "";
        return family.toLowerCase().includes(String(name).toLowerCase());
      },
      { name: expectedUiFontName },
    );
  }
  await ensureLocaleSelected(page, locale);
  await waitForLocaleApplied(page, locale);

  const openPresetSetupWizardToRecommendations = async () => {
    await page.getByTestId("preset-import-recommended-pack").click();

    await page.getByTestId("preset-setup-wizard").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("preset-setup-wizard-step-welcome").waitFor({ state: "visible", timeout: 30_000 });

    const next = page.getByTestId("preset-setup-wizard-next");

    await next.click();
    await page.getByTestId("preset-setup-wizard-step-codec").waitFor({ state: "visible", timeout: 30_000 });

    await next.click();
    await page.getByTestId("preset-setup-wizard-step-useCase").waitFor({ state: "visible", timeout: 30_000 });

    await next.click();
    await page.getByTestId("preset-setup-wizard-step-presets").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("preset-setup-wizard-preset-card").first().waitFor({ state: "visible", timeout: 30_000 });
  };

  const openJobCompareDialogWipe = async () => {
    const card = page.getByTestId("queue-item-card").first();
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.hover();

    const compareBtn = card.getByTestId("queue-item-compare-button");
    await compareBtn.waitFor({ state: "visible", timeout: 30_000 });
    await compareBtn.click();

    const viewport = page.getByTestId("job-compare-viewport");
    await viewport.waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("job-compare-mode-wipe").click();
    await page.getByTestId("job-compare-wipe-divider").waitFor({ state: "visible", timeout: 30_000 });

    const track = page.getByTestId("job-compare-wipe-handle");
    await track.waitFor({ state: "visible", timeout: 30_000 });
    const grip = page.locator('[data-testid="job-compare-wipe-handle"] .cursor-ew-resize > div');
    await grip.waitFor({ state: "visible", timeout: 30_000 });

    const trackBox = await track.boundingBox();
    const gripBox = await grip.boundingBox();
    if (trackBox && gripBox) {
      const y = Math.round(trackBox.y + trackBox.height / 2);
      const targetX = Math.round(trackBox.x + trackBox.width * 0.62);
      await page.mouse.move(Math.round(gripBox.x + gripBox.width / 2), Math.round(gripBox.y + gripBox.height / 2));
      await page.mouse.down();
      await page.mouse.move(targetX, y);
      await page.mouse.up();

      await page.waitForFunction(() => {
        const divider = document.querySelector('[data-testid="job-compare-wipe-divider"]');
        const left = divider instanceof HTMLElement ? divider.style.left : "";
        const n = Number(String(left).replace("%", ""));
        return Number.isFinite(n) && n > 58 && n < 70;
      });
    }

    // Wait for the debounced "high" frame pass so screenshots aren't blurred.
    await page.waitForFunction(
      () => {
        const inImg = document.querySelector('[data-testid="job-compare-transform-wipe-input"] img');
        const outImg = document.querySelector('[data-testid="job-compare-transform-wipe-output"] img');
        if (!(inImg instanceof HTMLImageElement) || !(outImg instanceof HTMLImageElement)) return false;
        return !inImg.style.filter && !outImg.style.filter;
      },
      undefined,
      { timeout: 30_000 },
    );
  };

  const setWipePercent = async (percent) => {
    const track = page.getByTestId("job-compare-wipe-handle");
    const grip = page.locator('[data-testid="job-compare-wipe-handle"] .cursor-ew-resize > div');
    const trackBox = await track.boundingBox();
    const gripBox = await grip.boundingBox();
    if (!trackBox || !gripBox) return;

    const y = Math.round(trackBox.y + trackBox.height / 2);
    const startX = Math.round(gripBox.x + gripBox.width / 2);
    const startY = Math.round(gripBox.y + gripBox.height / 2);
    const targetX = Math.round(trackBox.x + trackBox.width * (percent / 100));

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, y);
    await page.mouse.up();

    await page.waitForFunction(
      ({ min, max }) => {
        const divider = document.querySelector('[data-testid="job-compare-wipe-divider"]');
        const left = divider instanceof HTMLElement ? divider.style.left : "";
        const n = Number(String(left).replace("%", ""));
        return Number.isFinite(n) && n >= min && n <= max;
      },
      { min: percent - 2, max: percent + 2 },
    );
  };

  const writeCompareGif = async (localeSuffix) => {
    // Capture the full app shell so the compare dialog UI is visible in the GIF.
    const root = page.locator(".ffui-ui-scale-root");
    await root.waitFor({ state: "visible", timeout: 30_000 });

    const prefix = `compare-${localeSuffix}`;
    const framePattern = path.join(tmpDir, `${prefix}-frame-%02d.png`);
    const palettePath = path.join(tmpDir, `${prefix}-palette.png`);
    const gifPath = path.join(docsImagesDir, `${prefix}.gif`);

    const start = 18;
    const end = 82;
    const steps = 16;
    const forward = Array.from({ length: steps + 1 }, (_, i) => start + ((end - start) * i) / steps);
    const back = forward.slice(0, -1).reverse();
    const holds = [start, start, start];
    const percents = [...holds, ...forward.slice(1), end, end, end, ...back.slice(1), ...holds];

    for (let i = 0; i < percents.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await setWipePercent(percents[i]);
      // eslint-disable-next-line no-await-in-loop
      await sleep(120);
      const framePath = path.join(tmpDir, `${prefix}-frame-${String(i + 1).padStart(2, "0")}.png`);
      // eslint-disable-next-line no-await-in-loop
      await root.screenshot({ path: framePath });
    }

    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        "10",
        "-start_number",
        "1",
        "-i",
        framePattern,
        "-vf",
        "scale=1280:-1:flags=lanczos,palettegen",
        palettePath,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );

    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        "10",
        "-start_number",
        "1",
        "-i",
        framePattern,
        "-i",
        palettePath,
        "-filter_complex",
        "scale=1280:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
        "-loop",
        "0",
        gifPath,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );

    await setWipePercent(62);
    await sleep(100);

    return gifPath;
  };

  const waitForShotReady = async (shot) => {
    if (shot?.readyTestId) {
      await page.getByTestId(shot.readyTestId).first().waitFor({ state: "visible", timeout: 30_000 });
    }
    if (shot?.readySelector) {
      await page.locator(shot.readySelector).first().waitFor({ state: "visible", timeout: 30_000 });
    }
    if (shot?.readyText) {
      await page.getByText(shot.readyText).first().waitFor({ state: "visible", timeout: 30_000 });
    }
  };

  for (const shot of shots) {
    await page.getByTestId(`ffui-tab-${shot.tab}`).click();
    await page.getByTestId(shot.panelTestId).waitFor({ state: "visible", timeout: 30_000 });

    // Ensure the panel has loaded its async data before capturing.
    // eslint-disable-next-line no-await-in-loop
    await waitForShotReady(shot);

    if (shot.mode === "preset-setup-wizard") {
      // eslint-disable-next-line no-await-in-loop
      await openPresetSetupWizardToRecommendations();
    }
    if (shot.mode === "job-compare-wipe") {
      // eslint-disable-next-line no-await-in-loop
      await openJobCompareDialogWipe();
      if (compareFormat === "gif") {
        // eslint-disable-next-line no-await-in-loop
        await writeCompareGif(locale.suffix);
      }
    }

    // Let charts/components settle (best-effort).
    const settleMs = Number.isFinite(shot?.settleMs)
      ? Math.max(0, Math.round(shot.settleMs))
      : shot.tab === "monitor"
        ? 1250
        : 200;
    // eslint-disable-next-line no-await-in-loop
    await sleep(settleMs);

    const shouldWriteWebp = !(shot.mode === "job-compare-wipe" && compareFormat === "gif");
    if (shouldWriteWebp) {
      const pngPath = path.join(tmpDir, `${shot.outBase}-${locale.suffix}.png`);
      const webpPath = path.join(docsImagesDir, `${shot.outBase}-${locale.suffix}.webp`);

      await page.locator(".ffui-ui-scale-root").screenshot({ path: pngPath });
      // eslint-disable-next-line no-await-in-loop
      await convertPngToWebpWithViewport({
        pngPath,
        webpPath,
        viewport,
        targetSize: shot.targetSize ?? viewport,
        deviceScaleFactor,
      });
    }

    if (shot.mode === "job-compare-wipe") {
      // The compare dialog blocks tab navigation; close it before the next shot.
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press("Escape");
      // eslint-disable-next-line no-await-in-loop
      await page.getByTestId("job-compare-viewport").waitFor({ state: "hidden", timeout: 30_000 });
    }
  }

  await context.close();
};

const main = async () => {
  const args = parseArgs(resolveCliArgv());
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.mediaDir) {
    printHelp();
    throw new Error("Missing required --media-dir <DIR>");
  }

  await ensureDir(tmpDir);

  const outSize = resolveOutputSize(args);
  const deviceScaleFactor = clampInt(args.deviceScaleFactor, 1, 3, 1);

  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    throw new Error("Missing Playwright dependency. Run `pnpm install` first (it will install Playwright).", {
      cause: error,
    });
  }

  const media = await prepareLocalMedia(args);
  const expectedFontSizePercent = resolveUiFontSizePercent(args);
  const expectedUiScalePercent = resolveUiScalePercent(args);
  const expectedUiFontName = args.uiFontName;
  const monitorCaptureHeight = resolveCaptureHeight(args.monitorCaptureHeight, outSize.height + 40, outSize.height);
  const settingsCaptureHeight = resolveCaptureHeight(args.settingsCaptureHeight, outSize.height, outSize.height);

  let chromium;
  try {
    chromium = await playwright.chromium.launch({ headless: true });
  } catch (_error) {
    console.warn("[docs:screenshots] Playwright browser missing; installing Chromium…");
    try {
      await run("pnpm", ["exec", "playwright", "install", "chromium"], { cwd: repoRoot, stdio: "inherit" });
    } catch {
      const cliPath = path.join(repoRoot, "node_modules", "playwright", "cli.js");
      await run(process.execPath, [cliPath, "install", "chromium"], { cwd: repoRoot, stdio: "inherit" });
    }
    chromium = await playwright.chromium.launch({ headless: true });
  }

  try {
    await withDevServer(
      async ({ baseUrl }) => {
        for (const locale of LOCALES) {
          const onlyOutBases = Array.isArray(args.shots) && args.shots.length > 0 ? new Set(args.shots) : null;
          const wants = (outBase) => (onlyOutBases ? onlyOutBases.has(outBase) : true);

          const monitorShot = { ...SHOT_MONITOR, targetSize: outSize };
          const settingsShot = { ...SETTINGS_SHOT, targetSize: outSize };
          // eslint-disable-next-line no-await-in-loop
          await captureScreenshotsForLocale({
            chromium,
            baseUrl,
            locale,
            viewport: outSize,
            shots: SHOTS_MAIN.filter((s) => wants(s.outBase)),
            expectedFontSizePercent,
            expectedUiScalePercent,
            expectedUiFontName,
            deviceScaleFactor,
            compareFormat: args.compareFormat,
          });

          if (wants(monitorShot.outBase)) {
            // eslint-disable-next-line no-await-in-loop
            await captureScreenshotsForLocale({
              chromium,
              baseUrl,
              locale,
              viewport: { width: outSize.width, height: monitorCaptureHeight },
              shots: [monitorShot],
              expectedFontSizePercent,
              expectedUiScalePercent,
              expectedUiFontName,
              deviceScaleFactor,
              compareFormat: args.compareFormat,
            });
          }

          if (wants(settingsShot.outBase)) {
            // eslint-disable-next-line no-await-in-loop
            await captureScreenshotsForLocale({
              chromium,
              baseUrl,
              locale,
              viewport: { width: outSize.width, height: settingsCaptureHeight },
              shots: [settingsShot],
              expectedFontSizePercent,
              expectedUiScalePercent,
              expectedUiFontName,
              deviceScaleFactor,
              compareFormat: args.compareFormat,
            });
          }

          if (wants(SHOT_ONBOARDING.outBase)) {
            // eslint-disable-next-line no-await-in-loop
            await captureScreenshotsForLocale({
              chromium,
              baseUrl,
              locale,
              viewport: outSize,
              shots: [SHOT_ONBOARDING],
              expectedFontSizePercent,
              expectedUiScalePercent,
              expectedUiFontName,
              deviceScaleFactor,
              compareFormat: args.compareFormat,
            });
          }
        }
      },
      { ...media, port: args.port },
    );
  } finally {
    await chromium.close();
    await rm(tmpDir, { recursive: true, force: true });
    await media.cleanup?.();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
