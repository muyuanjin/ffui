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
    jobsList: null,
    processingJobs: 2,
    pausedJobs: 0,
    width: 900,
    height: 900,
    locale: "zh-CN",
    durationMs: 6000,
    tickMs: 50,
    previewMode: "static",
    ensurePreviewDelayMs: 0,
    scrollEveryMs: 40,
    scrollDeltaY: 240,
    includeCommand: true,
    progressStyle: "bar",
    sortPrimary: "addedTime",
    sortPrimaryDirection: "asc",
    sortSecondary: "filename",
    sortSecondaryDirection: "asc",
    modes: ["detail", "compact", "mini"],
    assert: false,
    minFps: 55,
    maxLagP95Ms: 20,
    maxDomRows: 120,
    maxDomIconRows: 180,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") continue;
    if (a === "--jobs") {
      parsed.jobs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--jobs-list") {
      parsed.jobsList = takeValue(args, i, a)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));
      i += 1;
      continue;
    }
    if (a === "--processing-jobs") {
      parsed.processingJobs = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--paused-jobs") {
      parsed.pausedJobs = Number(takeValue(args, i, a));
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
    if (a === "--preview-mode") {
      parsed.previewMode = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--ensure-preview-delay-ms") {
      parsed.ensurePreviewDelayMs = Number(takeValue(args, i, a));
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
    if (a === "--progress-style") {
      parsed.progressStyle = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--sort-primary") {
      parsed.sortPrimary = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--sort-primary-direction") {
      parsed.sortPrimaryDirection = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--sort-secondary") {
      parsed.sortSecondary = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--sort-secondary-direction") {
      parsed.sortSecondaryDirection = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--modes") {
      parsed.modes = takeValue(args, i, a)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
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
    if (a === "--max-dom-icon-rows") {
      parsed.maxDomIconRows = Number(takeValue(args, i, a));
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
          "  --jobs-list <CSV>      Total jobs list (e.g. 1000,10000,100000). When set, runs each entry.",
          "  --processing-jobs <N>  Processing jobs (default: 2)",
          "  --paused-jobs <N>      Paused jobs (default: 0)",
          "  --locale <LOCALE>      Locale query param (default: zh-CN)",
          "  --width <PX>           Viewport width (default: 900)",
          "  --height <PX>          Viewport height (default: 900)",
          "  --duration-ms <MS>     Perf run duration (default: 6000)",
          "  --tick-ms <MS>         Delta emit interval, 0 disables (default: 50)",
          "  --[no-]include-command Include long ffmpegCommand in jobs (default: on)",
          "  --preview-mode <M>     static|unique-rev|missing-auto-ensure (default: static)",
          "  --ensure-preview-delay-ms <MS> Delay for ensureJobPreview in mock mode (default: 0)",
          "  --progress-style <S>   Set ffui.queueProgressStyle (bar|card-fill|ripple-card)",
          "  --sort-primary <F>     Set ffui.queueSortPrimary (e.g. progress|elapsed|addedTime)",
          "  --sort-primary-direction <D>   Set ffui.queueSortPrimaryDirection (asc|desc)",
          "  --sort-secondary <F>   Set ffui.queueSortSecondary",
          "  --sort-secondary-direction <D> Set ffui.queueSortSecondaryDirection (asc|desc)",
          "  --modes <LIST>         Comma-separated: detail,compact,mini,icon-small,icon-medium,icon-large",
          "  --assert               Fail with non-zero exit when thresholds are not met",
          "  --min-fps <N>          Threshold when --assert (default: 55)",
          "  --max-lag-p95-ms <N>   Threshold when --assert (default: 20)",
          "  --max-dom-rows <N>     Threshold when --assert (default: 120)",
          "  --max-dom-icon-rows <N> Threshold when --assert (default: 180)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.jobs) || parsed.jobs <= 0) throw new Error(`Invalid --jobs: ${parsed.jobs}`);
  if (parsed.jobsList != null) {
    if (!Array.isArray(parsed.jobsList) || parsed.jobsList.length === 0) {
      throw new Error("Invalid --jobs-list: must be a non-empty CSV list");
    }
    for (const n of parsed.jobsList) {
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --jobs-list entry: ${n}`);
    }
  }
  if (!Number.isFinite(parsed.processingJobs) || parsed.processingJobs < 0)
    throw new Error(`Invalid --processing-jobs: ${parsed.processingJobs}`);
  if (!Number.isFinite(parsed.pausedJobs) || parsed.pausedJobs < 0)
    throw new Error(`Invalid --paused-jobs: ${parsed.pausedJobs}`);
  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error(`Invalid --width: ${parsed.width}`);
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error(`Invalid --height: ${parsed.height}`);
  if (!Number.isFinite(parsed.durationMs) || parsed.durationMs <= 0) throw new Error(`Invalid --duration-ms`);
  if (!Number.isFinite(parsed.tickMs) || parsed.tickMs < 0) throw new Error(`Invalid --tick-ms`);
  if (!Number.isFinite(parsed.ensurePreviewDelayMs) || parsed.ensurePreviewDelayMs < 0)
    throw new Error(`Invalid --ensure-preview-delay-ms: ${parsed.ensurePreviewDelayMs}`);
  if (!Number.isFinite(parsed.minFps) || parsed.minFps <= 0) throw new Error(`Invalid --min-fps: ${parsed.minFps}`);
  if (!Number.isFinite(parsed.maxLagP95Ms) || parsed.maxLagP95Ms < 0)
    throw new Error(`Invalid --max-lag-p95-ms: ${parsed.maxLagP95Ms}`);
  if (!Number.isFinite(parsed.maxDomRows) || parsed.maxDomRows <= 0)
    throw new Error(`Invalid --max-dom-rows: ${parsed.maxDomRows}`);
  if (!Number.isFinite(parsed.maxDomIconRows) || parsed.maxDomIconRows <= 0)
    throw new Error(`Invalid --max-dom-icon-rows: ${parsed.maxDomIconRows}`);
  if (!["bar", "card-fill", "ripple-card"].includes(parsed.progressStyle)) {
    throw new Error(`Invalid --progress-style: ${parsed.progressStyle}`);
  }
  const sortDirections = new Set(["asc", "desc"]);
  if (!sortDirections.has(parsed.sortPrimaryDirection)) {
    throw new Error(`Invalid --sort-primary-direction: ${parsed.sortPrimaryDirection}`);
  }
  if (!sortDirections.has(parsed.sortSecondaryDirection)) {
    throw new Error(`Invalid --sort-secondary-direction: ${parsed.sortSecondaryDirection}`);
  }
  const sortFields = new Set([
    "filename",
    "status",
    "addedTime",
    "finishedTime",
    "duration",
    "elapsed",
    "progress",
    "type",
    "path",
    "inputSize",
    "outputSize",
    "createdTime",
    "modifiedTime",
  ]);
  if (!sortFields.has(parsed.sortPrimary)) {
    throw new Error(`Invalid --sort-primary: ${parsed.sortPrimary}`);
  }
  if (!sortFields.has(parsed.sortSecondary)) {
    throw new Error(`Invalid --sort-secondary: ${parsed.sortSecondary}`);
  }

  const validModes = new Set(["detail", "compact", "mini", "icon-small", "icon-medium", "icon-large"]);
  for (const mode of parsed.modes) {
    if (!validModes.has(mode)) throw new Error(`Invalid --modes entry: ${mode}`);
  }

  const validPreviewModes = new Set(["static", "unique-rev", "missing-auto-ensure"]);
  if (!validPreviewModes.has(parsed.previewMode)) {
    throw new Error(`Invalid --preview-mode: ${parsed.previewMode}`);
  }

  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const setQueueViewMode = async (page, modeTestId) => {
  await page.getByTestId("ffui-queue-view-mode-trigger").click();
  await page.getByTestId(modeTestId).click();
  await page.waitForTimeout(150);
};

const ensureQueuePanelVisible = async (page) => {
  await page.getByTestId("ffui-tab-queue").click();
  await page.locator("[data-testid='queue-panel']").waitFor({ state: "visible", timeout: 90_000 });
};

const waitForQueueModeReady = async (page, mode) => {
  if (mode.startsWith("icon-")) {
    await page.getByTestId("queue-icon-grid").waitFor({ state: "visible", timeout: 90_000 });
    await page.getByTestId("queue-icon-grid").locator("[data-testid='queue-icon-item']").first().waitFor({
      state: "visible",
      timeout: 90_000,
    });
    return;
  }

  await page.locator("[data-testid='queue-item-card']").first().waitFor({ state: "visible", timeout: 90_000 });
};

const isContextDestroyedError = (error) => {
  const message = String((error && (error.message ?? error)) ?? "");
  return message.includes("Execution context was destroyed") || message.includes("most likely because of a navigation");
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

    const tickMs = Math.max(0, Math.floor(opts.tickMs));
    const shouldEmit = tickMs > 0 && jobIds.length > 0;
    const tickTimer = shouldEmit ? globalThis.setInterval(emitTick, tickMs) : null;

    const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
    while (nowMs() < endAt) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
    }

    if (tickTimer != null) globalThis.clearInterval(tickTimer);
    globalThis.clearInterval(lagTimer);
    rafActive = false;

    const elapsedMs = Math.max(1, nowMs() - startedAt);
    const fps = (rafFrames * 1000) / elapsedMs;

    const domRows = globalThis.document.querySelectorAll("[data-testid='queue-item-card']").length;
    const domIconRows = globalThis.document.querySelectorAll("[data-testid='queue-icon-item']").length;
    const queuePerf = globalThis.__FFUI_QUEUE_PERF__ ?? null;

    return {
      elapsedMs,
      tickMs,
      deltaRevision,
      rafFrames,
      fps,
      eventLoopLagP95Ms: sortedP95(lagSamples),
      domRows,
      domIconRows,
      queuePerf,
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
  if (typeof result?.domIconRows === "number" && result.domIconRows > thresholds.maxDomIconRows) {
    failures.push(`domIconRows=${result.domIconRows} > ${thresholds.maxDomIconRows}`);
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
        await context.addInitScript(
          (prefs) => {
            try {
              globalThis.localStorage?.setItem("ffui.queueProgressStyle", String(prefs.progressStyle));
              globalThis.localStorage?.setItem("ffui.queueSortPrimary", String(prefs.sortPrimary));
              globalThis.localStorage?.setItem("ffui.queueSortPrimaryDirection", String(prefs.sortPrimaryDirection));
              globalThis.localStorage?.setItem("ffui.queueSortSecondary", String(prefs.sortSecondary));
              globalThis.localStorage?.setItem(
                "ffui.queueSortSecondaryDirection",
                String(prefs.sortSecondaryDirection),
              );
            } catch {
              // ignore
            }
          },
          {
            progressStyle: args.progressStyle,
            sortPrimary: args.sortPrimary,
            sortPrimaryDirection: args.sortPrimaryDirection,
            sortSecondary: args.sortSecondary,
            sortSecondaryDirection: args.sortSecondaryDirection,
          },
        );
        const jobIds = [];
        for (let i = 0; i < Math.max(0, args.processingJobs); i += 1) {
          jobIds.push(`docs-perf-${String(i).padStart(6, "0")}`);
        }

        const thresholds = {
          minFps: args.minFps,
          maxLagP95Ms: args.maxLagP95Ms,
          maxDomRows: args.maxDomRows,
          maxDomIconRows: args.maxDomIconRows,
        };

        const jobsRuns = Array.isArray(args.jobsList) && args.jobsList.length > 0 ? args.jobsList : [args.jobs];
        const runs = [];

        for (const jobsCount of jobsRuns) {
          const page = await context.newPage();
          try {
            const url = new URL(ensureTrailingSlash(baseUrl));
            url.searchParams.set("ffuiLocale", args.locale);
            url.searchParams.set("ffuiQueueJobs", String(jobsCount));
            url.searchParams.set("ffuiQueueProcessingJobs", String(args.processingJobs));
            url.searchParams.set("ffuiQueuePausedJobs", String(args.pausedJobs));
            if (args.includeCommand) {
              url.searchParams.set("ffuiQueueIncludeCommand", "1");
            }
            url.searchParams.set("ffuiQueuePreviewMode", String(args.previewMode));
            if (args.ensurePreviewDelayMs > 0) {
              url.searchParams.set("ffuiQueueEnsurePreviewDelayMs", String(Math.floor(args.ensurePreviewDelayMs)));
            }

            await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
            await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 90_000 });
            await page.getByTestId("ffui-tab-queue").click();
            await page.locator("[data-testid='queue-panel']").waitFor({ state: "visible", timeout: 90_000 });
            // Vite may trigger a one-time reload while optimizing deps; wait briefly
            // so the perf run doesn't start inside a navigation.
            await page.waitForTimeout(1200);

            const results = {};

            const runMode = async (mode, testId, key) => {
              let lastError = null;
              for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                  await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
                  await ensureQueuePanelVisible(page);
                  await setQueueViewMode(page, testId);
                  await waitForQueueModeReady(page, mode);
                  // Vite may trigger a one-time dependency optimization reload the first
                  // time a mode is mounted (icon views are often the first to load).
                  // Give it a moment to settle before starting page.evaluate().
                  await page.waitForLoadState("domcontentloaded", { timeout: 90_000 });
                  await page.waitForTimeout(900);

                  const perfRun = startPerfRun(page, {
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
                  results[key] = await perfRun;
                  if (args.assert) assertResult(`${mode} (jobs=${jobsCount})`, results[key], thresholds);
                  return;
                } catch (error) {
                  lastError = error;
                  if (!isContextDestroyedError(error) || attempt === 2) {
                    throw error;
                  }
                  // Retry after navigation/reload.
                  await page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => {});
                  await page.waitForTimeout(1200);
                }
              }
              if (lastError) throw lastError;
            };

            for (const mode of args.modes) {
              if (mode === "detail") await runMode("detail", "ffui-queue-view-mode-detail", "detail");
              else if (mode === "compact") await runMode("compact", "ffui-queue-view-mode-compact", "compact");
              else if (mode === "mini") await runMode("mini", "ffui-queue-view-mode-mini", "mini");
              else if (mode === "icon-small")
                await runMode("icon-small", "ffui-queue-view-mode-icon-small", "iconSmall");
              else if (mode === "icon-medium")
                await runMode("icon-medium", "ffui-queue-view-mode-icon-medium", "iconMedium");
              else if (mode === "icon-large")
                await runMode("icon-large", "ffui-queue-view-mode-icon-large", "iconLarge");
            }

            runs.push({ jobs: jobsCount, results });
          } finally {
            await page.close().catch(() => {});
          }
        }

        // eslint-disable-next-line no-console
        console.log("[perf] queue large list (browser):", JSON.stringify({ args, runs }, null, 2));
      } finally {
        await browser.close();
      }
    },
  );
};

await main();
