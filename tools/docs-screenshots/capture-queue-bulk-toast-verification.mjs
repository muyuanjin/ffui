import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const pad2 = (value) => String(value).padStart(2, "0");

const timestampDirname = () => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const min = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
};

const assertPathUnused = async (filepath) => {
  try {
    await fs.stat(filepath);
    throw new Error(`Refusing to overwrite existing file: ${filepath}`);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return;
    throw err;
  }
};

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
    outDir: path.join(
      repoRoot,
      "tools",
      "docs-screenshots",
      "artifacts",
      "queue-bulk-toast-verification",
      timestampDirname(),
    ),
    width: 920,
    height: 680,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out-dir") {
      parsed.outDir = takeValue(args, i, a);
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
          "  node tools/docs-screenshots/capture-queue-bulk-toast-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/queue-bulk-toast-verification)",
          "  --width <PX>      Viewport width (default: 920)",
          "  --height <PX>     Viewport height (default: 680)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const disableAnimations = async (page) => {
  await page.addStyleTag({
    content: [
      "* {",
      "  animation-duration: 0s !important;",
      "  animation-delay: 0s !important;",
      "  transition-duration: 0s !important;",
      "  transition-delay: 0s !important;",
      "}",
      "[data-sonner-toaster], [data-sonner-toast] {",
      "  transition: none !important;",
      "}",
    ].join("\n"),
  });
};

const pickSelectableQueueItems = async (page, timeoutMs = 90_000) => {
  const candidates = [
    { name: "queue-item-card", locator: page.locator("[data-testid='queue-item-card']") },
    { name: "queue-icon-item", locator: page.locator("[data-testid='queue-icon-item']") },
    { name: "queue-icon-batch-item", locator: page.locator("[data-testid='queue-icon-batch-item']") },
    { name: "ffui-carousel-3d-card", locator: page.locator("[data-testid='ffui-carousel-3d-card']") },
  ];

  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a selectable queue item (list/icon/batch).");
    }

    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const count = await candidate.locator.count();
      if (count <= 0) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await candidate.locator.first().waitFor({ state: "visible", timeout: 250 });
        return candidate;
      } catch {
        // Ignore and continue polling.
      }
    }

    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(200);
  }
};

const selectSomeJobs = async (page) => {
  const { locator } = await pickSelectableQueueItems(page, 90_000);
  const total = await locator.count();
  const clicks = Math.min(5, Math.max(1, total));
  for (let i = 0; i < clicks; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await locator.nth(i).click();
  }
  await page.locator("[data-testid='queue-selection-count']").waitFor({ state: "visible", timeout: 90_000 });
};

const triggerBulkPause = async (page, locale) => {
  // Keep selectors stable by relying on the selection bar container class.
  const selectionBar = page.locator(".queue-selection-bar");
  await selectionBar.waitFor({ state: "visible", timeout: 90_000 });

  const pauseLabel = locale === "zh-CN" ? "批量暂停" : "Pause";
  await selectionBar.getByRole("button", { name: pauseLabel }).click();
};

const captureToasts = async (page, locale, outDir) => {
  const bulkPauseTitle = locale === "zh-CN" ? "批量暂停" : "Bulk pause";
  const detailsLabel = locale === "zh-CN" ? "详情" : "Details";
  const reportTitle = locale === "zh-CN" ? "批量操作报告" : "Bulk operation report";

  const bulkToast = page.locator("[data-sonner-toast]").filter({ hasText: bulkPauseTitle }).first();
  await bulkToast.waitFor({ state: "visible", timeout: 90_000 });
  const bulkToastPath = path.join(outDir, `toast-bulk-pause-${locale}.png`);
  await assertPathUnused(bulkToastPath);
  await bulkToast.screenshot({ path: bulkToastPath });

  await bulkToast.getByRole("button", { name: detailsLabel }).click();

  const reportToast = page.locator("[data-sonner-toast]").filter({ hasText: reportTitle }).first();
  await reportToast.waitFor({ state: "visible", timeout: 90_000 });
  const reportToastPath = path.join(outDir, `toast-bulk-pause-report-${locale}.png`);
  await assertPathUnused(reportToastPath);
  await reportToast.screenshot({ path: reportToastPath });
};

const captureLocale = async (page, baseUrl, locale, outDir) => {
  const url = `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(locale)}&ffuiQueueScenario=${encodeURIComponent(
    "batch-compress-composite",
  )}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const queuePanel = page.locator("[data-testid='queue-panel']");
  await queuePanel.waitFor({ state: "attached", timeout: 90_000 });

  await disableAnimations(page);

  const debugPanelPath = path.join(outDir, `debug-queue-panel-${locale}.png`);
  await assertPathUnused(debugPanelPath);
  await queuePanel.screenshot({ path: debugPanelPath });

  const debugFullPath = path.join(outDir, `debug-full-${locale}.png`);
  await assertPathUnused(debugFullPath);
  await page.screenshot({ path: debugFullPath, fullPage: true });

  await selectSomeJobs(page);
  await triggerBulkPause(page, locale);
  await captureToasts(page, locale, outDir);
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`[docs-screenshots] outDir=${args.outDir}`);

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

        await captureLocale(page, baseUrl, "en", args.outDir);
        await captureLocale(page, baseUrl, "zh-CN", args.outDir);
      } finally {
        await browser.close();
      }
    },
  );
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
