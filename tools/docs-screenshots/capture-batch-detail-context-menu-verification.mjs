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

const findOpenPort = async (startPort) => {
  let port = startPort;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
    if (ok) return port;
    port += 1;
  }
};

const waitForHttpOk = async (url, timeoutMs = 30000) => {
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
    await sleep(200);
  }
};

const withDevServer = async ({ startPort }, fn) => {
  const port = await findOpenPort(startPort);
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
    baseUrl: "",
    outDir: path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "batch-detail-context-menu"),
    locale: "zh-CN",
    width: 520,
    height: 560,
    port: 5173,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base-url") {
      parsed.baseUrl = takeValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--out-dir") {
      parsed.outDir = takeValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--locale") {
      parsed.locale = takeValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--width") {
      parsed.width = Number(takeValue(args, i, a));
      i++;
      continue;
    }
    if (a === "--height") {
      parsed.height = Number(takeValue(args, i, a));
      i++;
      continue;
    }
    if (a === "--port") {
      parsed.port = Number(takeValue(args, i, a));
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-batch-detail-context-menu-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/batch-detail-context-menu)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 520)",
          "  --height <PX>     Viewport height (default: 560)",
          "  --port <PORT>     Dev server port start (default: 5173)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }
  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const waitFor = async (fn, { timeoutMs = 30000, intervalMs = 200 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await fn();
    if (ok) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

const openQueueTab = async (page) => {
  const queueTab = page.locator("[data-testid='ffui-tab-queue']");
  if ((await queueTab.count()) > 0) {
    await queueTab.click({ force: true });
  }
  await waitFor(async () => (await page.locator("[data-testid='queue-panel']").count()) > 0);
};

const setQueueViewModeToIconMedium = async (page) => {
  const trigger = page.locator("[data-testid='ffui-queue-view-mode-trigger']");
  await waitFor(async () => (await trigger.count()) > 0);
  await trigger.click({ force: true });

  const option = page.locator("[data-testid='ffui-queue-view-mode-icon-medium']");
  await waitFor(async () => (await option.count()) > 0);
  await option.click({ force: true });
  // Close the select popover so it doesn't intercept later clicks.
  await page.keyboard.press("Escape");
  await waitFor(async () => (await option.isVisible()) === false);

  await waitFor(async () => (await page.locator("[data-testid='queue-icon-grid']").count()) > 0);
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  const captureOne = async ({ baseUrl }) => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: args.width, height: args.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      const url = `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });

      await waitFor(async () => (await page.locator("[data-testid='ffui-sidebar']").count()) > 0);
      await openQueueTab(page);

      await setQueueViewModeToIconMedium(page);
      await page.screenshot({ path: path.join(args.outDir, `queue-icon-view-ready-${args.locale}.png`), fullPage: false });

      const batchCount = await page.locator("[data-testid='queue-icon-batch-item']").count();
      const jobCount = await page.locator("[data-testid='queue-item-card']").count();
      console.log(
        `[verify:batch-detail-context-menu] counts: queue-icon-batch-item=${batchCount} queue-item-card=${jobCount}`,
      );

      const batch = page.locator("[data-testid='queue-icon-batch-item']").first();
      await waitFor(async () => (await batch.count()) > 0);
      await batch.scrollIntoViewIfNeeded();
      await batch.screenshot({ path: path.join(args.outDir, `icon-batch-card-${args.locale}.png`) });

      // Click inside the thumbnail grid to open the batch detail dialog (avoid the selection toggle logic).
      const previewGrid = batch.locator("[data-testid='queue-icon-batch-preview-grid']");
      await waitFor(async () => (await previewGrid.count()) > 0);
      await previewGrid.scrollIntoViewIfNeeded();
      // Use dispatchEvent so overlays (badges/selection indicator) don't steal the click.
      await previewGrid.dispatchEvent("click", { bubbles: true, cancelable: true });
      await page.screenshot({ path: path.join(args.outDir, `after-open-detail-click-${args.locale}.png`), fullPage: false });

      const batchDialog = page.locator("[data-testid='batch-detail-dialog']");
      await waitFor(async () => (await batchDialog.count()) > 0, { timeoutMs: 60_000 });
      await batchDialog.screenshot({ path: path.join(args.outDir, `batch-detail-dialog-${args.locale}.png`) });

      const batchBody = page.locator("[data-testid='batch-detail-body']");
      await waitFor(async () => (await batchBody.count()) > 0, { timeoutMs: 60_000 });

      // Scroll to the last job and right-click near the bottom-right to stress the viewport clamping.
      const lastJob = batchBody.locator("[data-testid='queue-item-card']").last();
      await waitFor(async () => (await lastJob.count()) > 0);
      await lastJob.scrollIntoViewIfNeeded();

      // Dispatch a contextmenu event at the viewport edge to verify we clamp to the desktop window bounds.
      await lastJob.dispatchEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: args.width - 2,
        clientY: args.height - 2,
      });

      const menuRoot = page.locator("[data-testid='queue-context-menu-root']");
      await waitFor(async () => (await menuRoot.count()) > 0);

      const menu = menuRoot.locator("[data-testid='queue-context-menu']");
      await waitFor(async () => (await menu.count()) > 0);

      const menuRect = await page.evaluate(() => {
        const el = document.querySelector("[data-testid='queue-context-menu']");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      });

      if (!menuRect) throw new Error("Failed to read context menu rect.");
      if (menuRect.left < 0 || menuRect.top < 0 || menuRect.right > args.width + 0.5 || menuRect.bottom > args.height + 0.5) {
        throw new Error(
          `Expected context menu to be fully within viewport; got rect=${JSON.stringify(menuRect)} viewport=${args.width}x${args.height}`,
        );
      }

      await menu.screenshot({ path: path.join(args.outDir, `batch-detail-context-menu-${args.locale}.png`) });
      await page.screenshot({
        path: path.join(args.outDir, `batch-detail-context-menu-overlay-${args.locale}.png`),
        fullPage: false,
      });
    } finally {
      await browser.close();
    }
  };

  if (args.baseUrl) {
    await captureOne({ baseUrl: args.baseUrl });
    return;
  }

  await withDevServer({ startPort: args.port }, captureOne);
};

main().catch((error) => {
  console.error("[verify:batch-detail-context-menu]", error);
  process.exitCode = 1;
});
