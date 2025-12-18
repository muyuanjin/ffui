import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const takeValue = (args, idx, flag) => {
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/queue-preview-revision-refresh"),
    locale: "zh-CN",
    port: 5173,
    width: 980,
    height: 720,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out-dir") {
      parsed.outDir = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--locale") {
      parsed.locale = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--port") {
      parsed.port = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--width") {
      parsed.width = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--height") {
      parsed.height = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-queue-preview-revision-refresh.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --port <PORT>     Dev server port start (default: 5173)",
          "  --width <PX>      Viewport width (default: 980)",
          "  --height <PX>     Viewport height (default: 720)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.port) || parsed.port <= 0) throw new Error("--port must be a number > 0");
  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error("--width must be a number > 0");
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error("--height must be a number > 0");
  return parsed;
};

const findOpenPort = async (startPort) => {
  for (let p = startPort; p < startPort + 40; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(p, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return p;
  }
  throw new Error(`Could not find an open port starting from ${startPort}`);
};

const waitForHttpOk = async (url, timeoutMs = 30_000) => {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for dev server: ${url}`);
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
};

const withDevServer = async (options, fn) => {
  const port = await findOpenPort(options.port);
  const baseUrl = `http://127.0.0.1:${port}/`;

  const env = {
    ...process.env,
    BROWSER: "none",
    LANG: "en_US.UTF-8",
    VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
  };

  const server = spawn(
    process.execPath,
    [viteBin, "--config", configPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: repoRoot, env, stdio: "inherit" },
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

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const injectSrcOverlay = async (page) => {
  await page.evaluate(() => {
    const id = "ffui-debug-preview-src-overlay";
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.left = "8px";
    el.style.bottom = "8px";
    el.style.zIndex = "999999";
    el.style.maxWidth = "calc(100vw - 16px)";
    el.style.padding = "6px 8px";
    el.style.font =
      '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    el.style.background = "rgba(0, 0, 0, 0.75)";
    el.style.color = "white";
    el.style.borderRadius = "6px";
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "hidden";
    el.style.textOverflow = "ellipsis";
    el.textContent = "queue thumbnail src: (pending)";
    document.body.appendChild(el);
  });
};

const setOverlayToThumbnailSrc = async (page) => {
  await page.evaluate(() => {
    const overlay = document.getElementById("ffui-debug-preview-src-overlay");
    const img = document.querySelector("[data-testid='queue-item-thumbnail'] img");
    if (!overlay) return;
    overlay.textContent = `queue thumbnail src: ${img?.getAttribute("src") ?? "(none)"}`;
  });
};

const emitQueueStateLite = async (page, payload) => {
  await page.evaluate((p) => {
    const w = window;
    // In docs screenshot mode, the tauri-event mock exposes a global emitter.
    const emit = w.__FFUI_TAURI_EVENT_EMIT__;
    if (typeof emit !== "function") throw new Error("Missing window.__FFUI_TAURI_EVENT_EMIT__");
    emit("ffui://queue-state-lite", p);
  }, payload);
};

const main = async () => {
  const args = parseArgs();
  await ensureDir(args.outDir);

  await withDevServer(args, async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
    });

    try {
      await page.goto(`${baseUrl}?ffuiLocale=${encodeURIComponent(args.locale)}`, { waitUntil: "domcontentloaded" });

      // Force detail view so we have a stable thumbnail test id.
      await page.getByTestId("ffui-queue-view-mode-trigger").click();
      await page.getByTestId("ffui-queue-view-mode-detail").click();

      await page.getByTestId("queue-item-thumbnail").first().waitFor({ state: "visible", timeout: 30_000 });

      await injectSrcOverlay(page);

      // Simulate backend regeneration: stable previewPath but increasing previewRevision.
      const baseJob = {
        id: "docs-job-processing",
        filename: "C:/videos/feature_demo_processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 1536,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 37,
        startTime: 1_700_000_000_000,
        processingStartedMs: 1_700_000_000_000,
        inputPath: "C:/videos/feature_demo_processing.mp4",
        outputPath: "C:/videos/feature_demo_processing.mp4.compressed.mp4",
        previewPath: "/ffui.svg",
        logs: [],
        estimatedSeconds: 480,
      };

      // Seed a deterministic job snapshot so the initial screenshot always has a thumbnail.
      await emitQueueStateLite(page, { jobs: [{ ...baseJob, previewRevision: 0 }] });
      await page.waitForTimeout(250);
      await setOverlayToThumbnailSrc(page);
      await page.screenshot({ path: path.join(args.outDir, "01-before.png"), fullPage: false });

      await emitQueueStateLite(page, { jobs: [{ ...baseJob, previewRevision: 1 }] });
      await page.waitForTimeout(250);
      await setOverlayToThumbnailSrc(page);
      await page.screenshot({ path: path.join(args.outDir, "02-after-rev-1.png"), fullPage: false });

      await emitQueueStateLite(page, { jobs: [{ ...baseJob, previewRevision: 2 }] });
      await page.waitForTimeout(250);
      await setOverlayToThumbnailSrc(page);
      await page.screenshot({ path: path.join(args.outDir, "03-after-rev-2.png"), fullPage: false });
    } finally {
      await page.close();
      await browser.close();
    }
  });
};

await main();
