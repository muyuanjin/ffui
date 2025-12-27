import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { withViteDevServer } from "../docs-screenshots/lib/viteDevServer.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const takeValue = (args, idx, flag) => {
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    jobs: 800,
    processingJobs: 2,
    width: 900,
    height: 900,
    locale: "zh-CN",
    durationMs: 6000,
    tickMs: 50,
    scrollEveryMs: 40,
    scrollDeltaY: 240,
    includeCommand: true,
    assert: false,
    minFps: 55,
    maxLagP95Ms: 20,
    maxDomRows: 120,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") continue;
    if (a === "--jobs") {
      parsed.jobs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--processing-jobs") {
      parsed.processingJobs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--locale") {
      parsed.locale = takeValue(args, i, a);
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
    if (a === "--duration-ms") {
      parsed.durationMs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--tick-ms") {
      parsed.tickMs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--include-command") {
      parsed.includeCommand = true;
      continue;
    }
    if (a === "--no-include-command") {
      parsed.includeCommand = false;
      continue;
    }
    if (a === "--assert") {
      parsed.assert = true;
      continue;
    }
    if (a === "--no-assert") {
      parsed.assert = false;
      continue;
    }
    if (a === "--min-fps") {
      parsed.minFps = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--max-lag-p95-ms") {
      parsed.maxLagP95Ms = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--max-dom-rows") {
      parsed.maxDomRows = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  node tools/perf/queue-large-list.browser.perf.mjs [options]",
          "",
          "Options:",
          "  --jobs <N>             Total jobs (default: 800)",
          "  --processing-jobs <N>  Processing jobs (default: 2)",
          "  --locale <LOCALE>      Locale query param (default: zh-CN)",
          "  --width <PX>           Viewport width (default: 900)",
          "  --height <PX>          Viewport height (default: 900)",
          "  --duration-ms <MS>     Perf run duration (default: 6000)",
          "  --tick-ms <MS>         Delta emit interval (default: 50)",
          "  --[no-]include-command Include long ffmpegCommand in jobs (default: on)",
          "  --assert               Fail with non-zero exit when thresholds are not met",
          "  --min-fps <N>          Threshold when --assert (default: 55)",
          "  --max-lag-p95-ms <N>   Threshold when --assert (default: 20)",
          "  --max-dom-rows <N>     Threshold when --assert (default: 120)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.jobs) || parsed.jobs <= 0) throw new Error(`Invalid --jobs: ${parsed.jobs}`);
  if (!Number.isFinite(parsed.processingJobs) || parsed.processingJobs < 0)
    throw new Error(`Invalid --processing-jobs: ${parsed.processingJobs}`);
  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error(`Invalid --width: ${parsed.width}`);
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error(`Invalid --height: ${parsed.height}`);
  if (!Number.isFinite(parsed.durationMs) || parsed.durationMs <= 0) throw new Error(`Invalid --duration-ms`);
  if (!Number.isFinite(parsed.tickMs) || parsed.tickMs <= 0) throw new Error(`Invalid --tick-ms`);
  if (!Number.isFinite(parsed.minFps) || parsed.minFps <= 0) throw new Error(`Invalid --min-fps: ${parsed.minFps}`);
  if (!Number.isFinite(parsed.maxLagP95Ms) || parsed.maxLagP95Ms < 0)
    throw new Error(`Invalid --max-lag-p95-ms: ${parsed.maxLagP95Ms}`);
  if (!Number.isFinite(parsed.maxDomRows) || parsed.maxDomRows <= 0)
    throw new Error(`Invalid --max-dom-rows: ${parsed.maxDomRows}`);

  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const setQueueViewMode = async (page, modeTestId) => {
  await page.getByTestId("ffui-queue-view-mode-trigger").click();
  await page.getByTestId(modeTestId).click();
  await page.waitForTimeout(150);
};

const startPerfRun = async (page, options) => {
  return page.evaluate(async (opts) => {
    const nowMs = () => (typeof performance?.now === "function" ? performance.now() : Date.now());
    const sortedP95 = (values) => {
      if (!values.length) return null;
      const s = values.slice().sort((a, b) => a - b);
      const idx = Math.min(s.length - 1, Math.floor(s.length * 0.95));
      return s[idx];
    };

    const startedAt = nowMs();
    const endAt = startedAt + Math.max(0, Math.floor(opts.durationMs));

    const lagSamples = [];
    const LAG_SAMPLE_INTERVAL_MS = 100;
    let expected = nowMs() + LAG_SAMPLE_INTERVAL_MS;
    const lagTimer = globalThis.setInterval(() => {
      const now = nowMs();
      const lag = Math.max(0, now - expected);
      expected = now + LAG_SAMPLE_INTERVAL_MS;
      lagSamples.push(lag);
    }, LAG_SAMPLE_INTERVAL_MS);

    let rafFrames = 0;
    let rafActive = true;
    const rafTick = () => {
      if (!rafActive) return;
      rafFrames += 1;
      globalThis.requestAnimationFrame(rafTick);
    };
    globalThis.requestAnimationFrame(rafTick);

    const emitter = globalThis.__FFUI_TAURI_EVENT_EMIT__;
    if (typeof emitter !== "function") {
      throw new Error("Missing window.__FFUI_TAURI_EVENT_EMIT__ (docs screenshot tauri-event mock not active).");
    }

    const jobIds = opts.jobIds ?? [];
    const baseSnapshotRevision = Number(opts.baseSnapshotRevision ?? 1);
    let deltaRevision = 0;
    let t = 0;

    const emitTick = () => {
      deltaRevision += 1;
      t += 1;
      const patches = jobIds.map((id, idx) => {
        const wave = (t * 0.35 + idx * 13) % 100;
        return {
          id,
          progress: Math.max(0, Math.min(100, wave)),
          elapsedMs: 1000 + t * 50,
          logTail: `progress=${wave.toFixed(2)}`,
        };
      });
      emitter("ffui://queue-state-lite-delta", {
        baseSnapshotRevision,
        deltaRevision,
        patches,
      });
    };

    const tickMs = Math.max(10, Math.floor(opts.tickMs));
    const tickTimer = globalThis.setInterval(emitTick, tickMs);

    const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
    while (nowMs() < endAt) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
    }

    globalThis.clearInterval(tickTimer);
    globalThis.clearInterval(lagTimer);
    rafActive = false;

    const elapsedMs = Math.max(1, nowMs() - startedAt);
    const fps = (rafFrames * 1000) / elapsedMs;

    const domRows = globalThis.document.querySelectorAll("[data-testid='queue-item-card']").length;
    const domIconRows = globalThis.document.querySelectorAll("[data-testid='queue-icon-item']").length;

    return {
      elapsedMs,
      tickMs,
      deltaRevision,
      rafFrames,
      fps,
      eventLoopLagP95Ms: sortedP95(lagSamples),
      domRows,
      domIconRows,
    };
  }, options);
};

const assertResult = (label, result, thresholds) => {
  const failures = [];
  if (typeof result?.fps === "number" && result.fps < thresholds.minFps) {
    failures.push(`fps=${result.fps.toFixed(2)} < ${thresholds.minFps}`);
  }
  if (typeof result?.eventLoopLagP95Ms === "number" && result.eventLoopLagP95Ms > thresholds.maxLagP95Ms) {
    failures.push(`lagP95=${result.eventLoopLagP95Ms.toFixed(1)}ms > ${thresholds.maxLagP95Ms}ms`);
  }
  if (typeof result?.domRows === "number" && result.domRows > thresholds.maxDomRows) {
    failures.push(`domRows=${result.domRows} > ${thresholds.maxDomRows}`);
  }
  if (failures.length > 0) {
    const msg = `[perf] queue large list assert failed (${label}): ${failures.join(", ")}`;
    throw new Error(msg);
  }
};

const main = async () => {
  const args = parseArgs();

  await withViteDevServer(
    {
      repoRoot,
      viteBin,
      configPath,
      env: {
        LANG: "en_US.UTF-8",
        VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
        VITE_DOCS_SCREENSHOT_HAS_TAURI: "1",
      },
    },
    async ({ baseUrl }) => {
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: args.width, height: args.height },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();

        const url = new URL(ensureTrailingSlash(baseUrl));
        url.searchParams.set("ffuiLocale", args.locale);
        url.searchParams.set("ffuiQueueJobs", String(args.jobs));
        url.searchParams.set("ffuiQueueProcessingJobs", String(args.processingJobs));
        url.searchParams.set("ffuiQueuePausedJobs", "0");
        if (args.includeCommand) {
          url.searchParams.set("ffuiQueueIncludeCommand", "1");
        }

        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 90_000 });
        await page.getByTestId("ffui-tab-queue").click();
        await page.locator("[data-testid='queue-panel']").waitFor({ state: "visible", timeout: 90_000 });

        const jobIds = [];
        for (let i = 0; i < Math.max(0, args.processingJobs); i += 1) {
          jobIds.push(`docs-perf-${String(i).padStart(6, "0")}`);
        }

        const results = {};
        const thresholds = { minFps: args.minFps, maxLagP95Ms: args.maxLagP95Ms, maxDomRows: args.maxDomRows };

        // Detail list
        await setQueueViewMode(page, "ffui-queue-view-mode-detail");
        const detailRun = startPerfRun(page, {
          durationMs: args.durationMs,
          tickMs: args.tickMs,
          baseSnapshotRevision: 1,
          jobIds,
        });
        const scrollStartedAt = Date.now();
        while (Date.now() - scrollStartedAt < args.durationMs) {
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.wheel(0, args.scrollDeltaY);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(args.scrollEveryMs);
        }
        results.detail = await detailRun;
        if (args.assert) assertResult("detail", results.detail, thresholds);

        // Compact list
        await setQueueViewMode(page, "ffui-queue-view-mode-compact");
        const compactRun = startPerfRun(page, {
          durationMs: args.durationMs,
          tickMs: args.tickMs,
          baseSnapshotRevision: 1,
          jobIds,
        });
        const scrollStartedAt2 = Date.now();
        while (Date.now() - scrollStartedAt2 < args.durationMs) {
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.wheel(0, args.scrollDeltaY);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(args.scrollEveryMs);
        }
        results.compact = await compactRun;
        if (args.assert) assertResult("compact", results.compact, thresholds);

        // Mini list (densest)
        await setQueueViewMode(page, "ffui-queue-view-mode-mini");
        const miniRun = startPerfRun(page, {
          durationMs: args.durationMs,
          tickMs: args.tickMs,
          baseSnapshotRevision: 1,
          jobIds,
        });
        const scrollStartedAt3 = Date.now();
        while (Date.now() - scrollStartedAt3 < args.durationMs) {
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.wheel(0, args.scrollDeltaY);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(args.scrollEveryMs);
        }
        results.mini = await miniRun;
        if (args.assert) assertResult("mini", results.mini, thresholds);

        // eslint-disable-next-line no-console
        console.log("[perf] queue large list (browser):", JSON.stringify({ args, results }, null, 2));
      } finally {
        await browser.close();
      }
    },
  );
};

await main();
