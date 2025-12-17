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
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/ui-verification"),
    locale: "zh-CN",
    width: 420,
    height: 1064,
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
          "  node tools/docs-screenshots/capture-ui-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/ui-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 420)",
          "  --height <PX>     Viewport height (default: 1064)",
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

      await waitFor(async () => {
        return (await page.locator("[data-testid='ffui-sidebar']").count()) > 0;
      });

      // Ensure we're on Queue so the context menu can be opened from an existing item.
      const queueTab = page.locator("[data-testid='ffui-tab-queue']");
      if ((await queueTab.count()) > 0) {
        await queueTab.click({ force: true });
      }

      const sidebar = page.locator("[data-testid='ffui-sidebar']");
      await sidebar.screenshot({ path: path.join(args.outDir, `sidebar-${args.locale}.png`) });
      await page.screenshot({ path: path.join(args.outDir, `page-${args.locale}.png`), fullPage: false });

      // Queue context menu: open before navigating away.
      await waitFor(async () => (await page.locator("[data-testid='queue-item-card']").count()) > 0);
      const jobCard = page.locator("[data-testid='queue-item-card']").first();
      await jobCard.screenshot({ path: path.join(args.outDir, `queue-item-card-${args.locale}.png`) });
      const copyCommandButton = jobCard.locator("[data-testid='queue-item-copy-command']");
      await waitFor(async () => (await copyCommandButton.count()) > 0);
      await copyCommandButton.screenshot({
        path: path.join(args.outDir, `queue-item-copy-command-${args.locale}.png`),
      });
      await jobCard.click({ button: "right" });
      const menu = page.locator("[data-testid='queue-context-menu']");
      await waitFor(async () => (await menu.count()) > 0);
      await menu.screenshot({ path: path.join(args.outDir, `queue-context-menu-${args.locale}.png`) });
      await page.screenshot({
        path: path.join(args.outDir, `queue-context-menu-overlay-${args.locale}.png`),
        fullPage: false,
      });

      const iconCount = await page.evaluate(() => {
        const menuEl = document.querySelector("[data-testid='queue-context-menu']");
        if (!menuEl) return 0;
        return menuEl.querySelectorAll("svg").length;
      });
      if (iconCount === 0) {
        throw new Error("Expected context menu to render lucide icons, but found 0 SVGs.");
      }

      // Close the context menu before navigating to other tabs.
      await page.keyboard.press("Escape");
      await waitFor(async () => (await menu.count()) === 0);

      // Settings panel: verify check/radio styling consistency.
      const settingsTab = page.locator("[data-testid='ffui-tab-settings']");
      if ((await settingsTab.count()) > 0) {
        await settingsTab.click({ force: true });
        await waitFor(async () => (await page.locator("[data-testid='settings-panel']").count()) > 0);
        await page.screenshot({
          path: path.join(args.outDir, `settings-${args.locale}.png`),
          fullPage: false,
        });

        const statusBar = page.locator("[data-testid='settings-status-bar']");
        await waitFor(async () => (await statusBar.count()) > 0);
        await statusBar.scrollIntoViewIfNeeded();
        await statusBar.screenshot({
          path: path.join(args.outDir, `settings-status-bar-${args.locale}.png`),
        });
      }

      // Presets panel: verify responsive grid can expand beyond 2 columns on wide screens.
      const wideWidth = Math.max(args.width, 1440);
      const wideHeight = Math.min(args.height, 960);
      await page.setViewportSize({ width: wideWidth, height: wideHeight });

      const presetsTab = page.locator("[data-testid='ffui-tab-presets']");
      if ((await presetsTab.count()) > 0) {
        await presetsTab.click({ force: true });
        await waitFor(async () => (await page.locator("[data-testid='preset-panel']").count()) > 0);
        await page.screenshot({
          path: path.join(args.outDir, `presets-wide-${args.locale}.png`),
          fullPage: false,
        });

        const compactToggle = page.locator("[data-testid='preset-view-compact']");
        if ((await compactToggle.count()) > 0) {
          await compactToggle.click({ force: true });
          await page.screenshot({
            path: path.join(args.outDir, `presets-wide-compact-${args.locale}.png`),
            fullPage: false,
          });
        }
      }
    } finally {
      await browser.close();
    }
  };

  if (args.baseUrl) {
    await captureOne({ baseUrl: args.baseUrl });
    return;
  }

  await withDevServer({ startPort: args.port }, async ({ baseUrl }) => {
    await captureOne({ baseUrl });
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
