import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDirBase = path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "queue-large-list-scroll");
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
    outDir: outDirBase,
    jobs: 2000,
    processingJobs: 2,
    pausedJobs: 0,
    locale: "zh-CN",
    width: 900,
    height: 900,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out-dir") {
      parsed.outDir = takeValue(args, i, a);
      i += 1;
      continue;
    }
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
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-queue-large-list-scroll-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>          Output directory",
          "  --jobs <N>               Total jobs (default: 2000)",
          "  --processing-jobs <N>    Processing jobs (default: 2)",
          "  --paused-jobs <N>        Paused jobs (default: 0)",
          "  --locale <LOCALE>        Initial locale query param (default: zh-CN)",
          "  --width <PX>             Viewport width (default: 900)",
          "  --height <PX>            Viewport height (default: 900)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.jobs) || parsed.jobs <= 0) {
    throw new Error(`Invalid --jobs: ${parsed.jobs}`);
  }
  if (!Number.isFinite(parsed.processingJobs) || parsed.processingJobs < 0) {
    throw new Error(`Invalid --processing-jobs: ${parsed.processingJobs}`);
  }
  if (!Number.isFinite(parsed.pausedJobs) || parsed.pausedJobs < 0) {
    throw new Error(`Invalid --paused-jobs: ${parsed.pausedJobs}`);
  }
  if (!Number.isFinite(parsed.width) || parsed.width <= 0) {
    throw new Error(`Invalid --width: ${parsed.width}`);
  }
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) {
    throw new Error(`Invalid --height: ${parsed.height}`);
  }

  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const pad2 = (n) => String(n).padStart(2, "0");

const formatTimestamp = (date) => {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
};

const resolveUniqueOutDir = async (desiredDir) => {
  try {
    const stat = await fs.stat(desiredDir);
    if (stat.isDirectory()) {
      return `${desiredDir}-${formatTimestamp(new Date())}`;
    }
  } catch {
    // Not existing, ok.
  }
  return desiredDir;
};

const waitForStableCount = async (page, locator, options) => {
  const minCount = options?.minCount ?? 1;
  const stableMs = options?.stableMs ?? 300;
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const pollMs = options?.pollMs ?? 50;

  const startedAt = Date.now();
  let stableStartAt = null;

  while (Date.now() - startedAt < timeoutMs) {
    const count = await locator.count();
    if (count >= minCount) {
      if (stableStartAt == null) stableStartAt = Date.now();
      if (Date.now() - stableStartAt >= stableMs) return count;
    } else {
      stableStartAt = null;
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(pollMs);
  }

  throw new Error(`Timed out waiting for stable count>=${minCount} for locator.`);
};

const main = async () => {
  const args = parseArgs();
  args.outDir = await resolveUniqueOutDir(args.outDir);
  await fs.mkdir(args.outDir, { recursive: true });

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

        const errors = [];
        page.on("pageerror", (err) => errors.push(String(err?.message ?? err)));
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text());
        });

        const url = new URL(ensureTrailingSlash(baseUrl));
        url.searchParams.set("ffuiLocale", args.locale);
        url.searchParams.set("ffuiQueueJobs", String(args.jobs));
        url.searchParams.set("ffuiQueueProcessingJobs", String(args.processingJobs));
        url.searchParams.set("ffuiQueuePausedJobs", String(args.pausedJobs));

        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 90_000 });

        await page.getByTestId("ffui-tab-queue").click();

        const viewport = page.locator("[data-testid='queue-panel']");
        await viewport.waitFor({ state: "visible", timeout: 90_000 });

        const queueCards = page.locator("[data-testid='queue-item-card']");
        const initialCardCount = await waitForStableCount(page, queueCards, {
          minCount: 1,
          stableMs: 300,
          timeoutMs: 90_000,
        });
        if (args.jobs >= 50 && initialCardCount < 2) {
          throw new Error(
            `Queue scroll verification expected more than 1 initial card to be visible for large queues; saw ${initialCardCount}.`,
          );
        }
        if (initialCardCount > 250) {
          throw new Error(
            `Queue scroll verification expected virtualization to cap DOM rows; saw ${initialCardCount} queue item cards.`,
          );
        }

        await queueCards.first().click();
        const firstCardSelected = await queueCards.first().evaluate((el) => {
          const className = String(el?.className ?? "");
          return className.includes("ring-primary");
        });
        if (!firstCardSelected) {
          throw new Error("Queue scroll verification expected the first queue card to become selected after click.");
        }

        await queueCards.first().click({ button: "right" });
        await page.getByTestId("queue-context-menu").waitFor({ state: "visible", timeout: 90_000 });
        await page.keyboard.press("Escape");

        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(args.outDir, "queue-top.png"), fullPage: false });

        await viewport.hover();
        for (let i = 0; i < 20; i += 1) {
          await page.mouse.wheel(0, 1200);
          await page.waitForTimeout(25);
        }

        await page.waitForFunction(
          () => {
            const w = window;
            return Boolean((w && w.__FFUI_TAURI_EVENT_EMIT__) || false);
          },
          { timeout: 90_000 },
        );

        await page.waitForFunction(
          () => {
            const w = window;
            return Boolean((w && w.__FFUI_QUEUE_PERF__) || false);
          },
          { timeout: 90_000 },
        );

        await page.evaluate(async () => {
          const w = window;
          const emit = w.__FFUI_TAURI_EVENT_EMIT__;
          if (typeof emit !== "function") {
            throw new Error("Missing __FFUI_TAURI_EVENT_EMIT__ in docs screenshot mode.");
          }

          const raf = () =>
            new Promise((resolve) => {
              w.requestAnimationFrame(() => resolve(undefined));
            });

          const jobA = "docs-perf-000000";
          const jobB = "docs-perf-000001";
          let progressA = 10;
          let progressB = 10;
          let elapsedMs = 0;

          // Emit a steady delta stream across multiple frames to validate:
          // - event coalescing
          // - delta ordering
          // - UI smoothness under progress updates
          for (let rev = 1; rev <= 120; rev += 1) {
            progressA = Math.min(99, progressA + 0.7);
            progressB = Math.min(99, progressB + 0.5);
            elapsedMs += 120;

            emit("ffui://queue-state-lite-delta", {
              baseSnapshotRevision: 1,
              deltaRevision: rev,
              patches: [
                { id: jobA, status: "processing", progress: progressA, elapsedMs },
                { id: jobB, status: "processing", progress: progressB, elapsedMs },
              ],
            });

            // Yield so the app flushes to the UI thread.
            // eslint-disable-next-line no-await-in-loop
            await raf();
          }
        });

        const statusTransitionCounts = await page.evaluate(async () => {
          const w = window;
          const emit = w.__FFUI_TAURI_EVENT_EMIT__;
          if (typeof emit !== "function") {
            throw new Error("Missing __FFUI_TAURI_EVENT_EMIT__ in docs screenshot mode.");
          }

          const raf = () =>
            new Promise((resolve) => {
              w.requestAnimationFrame(() => resolve(undefined));
            });

          const jobA = "docs-perf-000000";
          const jobB = "docs-perf-000001";

          // Simulate "A completes, B becomes processing" to surface list re-order flashes.
          emit("ffui://queue-state-lite-delta", {
            baseSnapshotRevision: 1,
            deltaRevision: 121,
            patches: [
              { id: jobA, status: "completed", progress: 100, elapsedMs: 12_345 },
              { id: jobB, status: "processing", progress: 0, elapsedMs: 0 },
            ],
          });

          const counts = [];
          for (let i = 0; i < 20; i += 1) {
            counts.push(document.querySelectorAll("[data-testid='queue-item-card']").length);
            // eslint-disable-next-line no-await-in-loop
            await raf();
          }
          return counts;
        });
        const minCount = Math.min(...statusTransitionCounts);
        if (!Number.isFinite(minCount) || minCount < 1) {
          throw new Error(
            `Queue scroll verification expected queue rows to stay visible during status transitions; minCount=${minCount}`,
          );
        }

        const perf = await page.evaluate(() => {
          const snapshot = window.__FFUI_QUEUE_PERF__;
          return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
        });
        if (!perf) {
          throw new Error("Queue scroll verification expected __FFUI_QUEUE_PERF__ to be available.");
        }
        if ((perf.apply?.deltaCalls ?? 0) < 10) {
          throw new Error(
            `Queue scroll verification expected delta apply to run; deltaCalls=${perf.apply?.deltaCalls}`,
          );
        }
        const deltaAvgMs = perf.apply?.deltaAvgMs;
        if (typeof deltaAvgMs === "number" && Number.isFinite(deltaAvgMs) && deltaAvgMs > 2) {
          throw new Error(`Queue scroll verification: deltaAvgMs too high (${deltaAvgMs.toFixed(3)}ms).`);
        }
        const lagP95 = perf.loop?.eventLoopLagP95Ms;
        if (typeof lagP95 === "number" && Number.isFinite(lagP95) && lagP95 > 60) {
          throw new Error(`Queue scroll verification: eventLoopLagP95Ms too high (${lagP95.toFixed(1)}ms).`);
        }

        await page.screenshot({ path: path.join(args.outDir, "queue-after-scroll.png"), fullPage: false });

        // Startup/regression guard: simulate a delayed initial queue snapshot so the list
        // mounts after the "empty queue" state (matches real Tauri startup timings).
        const delayedUrl = new URL(ensureTrailingSlash(baseUrl));
        delayedUrl.searchParams.set("ffuiLocale", args.locale);
        delayedUrl.searchParams.set("ffuiQueueJobs", String(args.jobs));
        delayedUrl.searchParams.set("ffuiQueueProcessingJobs", String(args.processingJobs));
        delayedUrl.searchParams.set("ffuiQueuePausedJobs", String(args.pausedJobs));
        delayedUrl.searchParams.set("ffuiQueueJobsDelayMs", "1200");

        await page.goto(delayedUrl.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 90_000 });
        await page.getByTestId("ffui-tab-queue").click();

        await viewport.waitFor({ state: "visible", timeout: 90_000 });

        const delayedCardCount = await waitForStableCount(page, queueCards, {
          minCount: 1,
          stableMs: 300,
          timeoutMs: 90_000,
        });
        if (args.jobs >= 50 && delayedCardCount < 2) {
          throw new Error(
            `Queue scroll verification (delayed load) expected more than 1 initial card to be visible for large queues; saw ${delayedCardCount}.`,
          );
        }
        if (delayedCardCount > 250) {
          throw new Error(
            `Queue scroll verification (delayed load) expected virtualization to cap DOM rows; saw ${delayedCardCount} queue item cards.`,
          );
        }
        await page.screenshot({ path: path.join(args.outDir, "queue-top-delayed.png"), fullPage: false });

        if (errors.length > 0) {
          throw new Error(`Queue scroll verification saw console/page errors:\n${errors.join("\n")}`);
        }
      } finally {
        await browser.close();
      }
    },
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
