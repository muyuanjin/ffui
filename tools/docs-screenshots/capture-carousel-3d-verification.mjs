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
  while (true) {
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

const waitFor = async (fn, { timeoutMs = 30000, intervalMs = 200 } = {}) => {
  const start = Date.now();
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
  const outDir = path.join(repoRoot, "tools/docs-screenshots/artifacts/carousel-3d-verification");
  await fs.mkdir(outDir, { recursive: true });

  const captureOne = async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      const url = `${baseUrl}?ffuiLocale=zh-CN&ffuiQueueScenario=carousel-3d-many-items`;
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Wait for sidebar to load
      await waitFor(async () => {
        return (await page.locator("[data-testid='ffui-sidebar']").count()) > 0;
      });

      // Ensure we're on Queue tab
      const queueTab = page.locator("[data-testid='ffui-tab-queue']");
      if ((await queueTab.count()) > 0) {
        await queueTab.click({ force: true });
      }

      await sleep(500);

      // Take screenshot of default view first
      await page.screenshot({ path: path.join(outDir, "queue-default.png"), fullPage: false });

      // Find and click the view mode selector to switch to carousel-3d
      const viewModeTrigger = page.locator("[data-testid='ffui-queue-view-mode-trigger']");
      if ((await viewModeTrigger.count()) > 0) {
        await viewModeTrigger.click();
        await sleep(300);

        // Select carousel-3d option
        const carousel3dOption = page.locator("[data-testid='ffui-queue-view-mode-carousel-3d']");
        if ((await carousel3dOption.count()) > 0) {
          await carousel3dOption.click();
          await sleep(500);
        }
      }

      // Take screenshot of carousel view
      await page.screenshot({ path: path.join(outDir, "queue-carousel-3d.png"), fullPage: false });

      const carouselRoot = page.locator("[data-testid='ffui-carousel-3d-container']");
      await waitFor(async () => (await carouselRoot.count()) > 0);

      const activeCard = page.locator("[data-testid='ffui-carousel-3d-card'][data-active='true']");
      const header = page.locator("[data-testid='ffui-carousel-3d-header']");
      const pagination = page.locator("[data-testid='ffui-carousel-3d-pagination']");

      await waitFor(async () => (await activeCard.count()) > 0);
      await waitFor(async () => (await header.count()) > 0);
      await waitFor(async () => (await pagination.count()) > 0);

      const activeCardBox = await activeCard.first().boundingBox();
      const headerBox = await header.first().boundingBox();
      const paginationBox = await pagination.first().boundingBox();

      if (!activeCardBox || !headerBox || !paginationBox) {
        throw new Error("Missing bounding boxes for carousel layout verification.");
      }

      // Layout assertions: card should not overlap header or pagination controls.
      const headerBottom = headerBox.y + headerBox.height;
      const cardTop = activeCardBox.y;
      if (cardTop < headerBottom - 4) {
        throw new Error(`Active card overlaps header (cardTop=${cardTop}, headerBottom=${headerBottom}).`);
      }

      const cardBottom = activeCardBox.y + activeCardBox.height;
      const paginationTop = paginationBox.y;
      if (paginationTop < cardBottom - 4) {
        throw new Error(`Active card overlaps pagination (paginationTop=${paginationTop}, cardBottom=${cardBottom}).`);
      }

      await carouselRoot.screenshot({ path: path.join(outDir, "carousel-3d-container.png") });
      await pagination.screenshot({ path: path.join(outDir, "carousel-3d-pagination.png") });

      // Also capture just the main content area
      const mainContent = page.locator("main");
      if ((await mainContent.count()) > 0) {
        await mainContent.screenshot({ path: path.join(outDir, "carousel-3d-main.png") });
      }

      console.log(`Screenshots saved to: ${outDir}`);
    } finally {
      await browser.close();
    }
  };

  await withDevServer({ startPort: 5173 }, async ({ baseUrl }) => {
    await captureOne({ baseUrl });
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
