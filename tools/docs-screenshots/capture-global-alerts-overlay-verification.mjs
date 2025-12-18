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
      server.once("listening", () => server.close(() => resolve(true)));
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
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for dev server: ${url}`);
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
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    baseUrl: "",
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/global-alerts-overlay-verification"),
    locale: "zh-CN",
    width: 1100,
    height: 760,
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
          "  node tools/docs-screenshots/capture-global-alerts-overlay-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/global-alerts-overlay-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 1100)",
          "  --height <PX>     Viewport height (default: 760)",
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
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertWithin = (inner, outer, { tolerance = 0.5 } = {}) => {
  assert(inner.x >= outer.x - tolerance, `Expected inner.x (${inner.x}) >= outer.x (${outer.x})`);
  assert(inner.y >= outer.y - tolerance, `Expected inner.y (${inner.y}) >= outer.y (${outer.y})`);
  assert(
    inner.x + inner.width <= outer.x + outer.width + tolerance,
    `Expected inner.right (${inner.x + inner.width}) <= outer.right (${outer.x + outer.width})`,
  );
  assert(
    inner.y + inner.height <= outer.y + outer.height + tolerance,
    `Expected inner.bottom (${inner.y + inner.height}) <= outer.bottom (${outer.y + outer.height})`,
  );
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

      const queueTab = page.locator("[data-testid='ffui-tab-queue']");
      if ((await queueTab.count()) > 0) await queueTab.click({ force: true });

      const processingCard = page.locator("[data-testid='queue-item-card']", { hasText: "feature_demo_processing" });
      await waitFor(async () => (await processingCard.count()) > 0);
      await processingCard.first().click({ force: true });

      const bulkDelete = page.locator("[data-testid='queue-selection-bulk-delete']");
      await waitFor(async () => (await bulkDelete.count()) > 0);
      await bulkDelete.first().click({ force: true });

      const globalAlerts = page.locator("[data-testid='global-alerts']");
      await waitFor(async () => (await globalAlerts.count()) > 0);

      const title = page.locator("[data-testid='global-alert-title-queue']");
      await waitFor(async () => (await title.count()) > 0);
      const titleText = (await title.first().innerText()).trim();
      const expectedTitleByLocale = {
        "zh-CN": "任务队列",
        en: "Transcode Queue",
      };
      const expectedTitle = expectedTitleByLocale[args.locale];
      if (expectedTitle) assert(titleText === expectedTitle, `Expected title "${expectedTitle}", got "${titleText}"`);

      const dismiss = page.locator("[data-testid='global-alert-dismiss-queue']").first();
      await waitFor(async () => (await dismiss.count()) > 0);
      const dismissIcon = dismiss.locator("svg").first();
      await waitFor(async () => (await dismissIcon.count()) > 0);

      const mainEl = page.locator("main");
      await waitFor(async () => (await mainEl.count()) > 0);

      await mainEl.screenshot({ path: path.join(args.outDir, `global-alerts-overlay-${args.locale}.png`) });

      const dismissBox = await dismiss.boundingBox();
      const iconBox = await dismissIcon.boundingBox();
      assert(dismissBox, "Expected dismiss button to have a bounding box.");
      assert(iconBox, "Expected dismiss icon to have a bounding box.");
      assertWithin(iconBox, dismissBox);

      await page.mouse.click(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2, { force: true });
      await waitFor(async () => (await globalAlerts.count()) === 0);
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

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
