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

const assert3dCardsAreActuallyVisible = async ({ page, stage, activeCard, sideCards }) => {
  const stageBox = await stage.boundingBox();
  const activeBox = await activeCard.boundingBox();
  const activeIndex = await activeCard.getAttribute("data-index");

  if (!stageBox || !activeBox || !activeIndex) {
    throw new Error("Missing bounding boxes for 3D visibility verification.");
  }

  // Ensure the active card leaves enough margin so adjacent cards can peek out.
  const widthRatio = activeBox.width / stageBox.width;
  if (widthRatio > 0.9) {
    throw new Error(`Active card is too wide for 3D effect (ratio=${widthRatio.toFixed(3)}).`);
  }

  const within = (box, p) => {
    const eps = 0.5;
    return (
      p.x + eps >= box.x && p.x <= box.x + box.width - eps && p.y + eps >= box.y && p.y <= box.y + box.height - eps
    );
  };

  const isInsideActive = (p) => within(activeBox, p);
  const isInsideStage = (p) => within(stageBox, p);

  const trySamplePoint = async ({ box }) => {
    const midY = box.y + box.height / 2;
    const candidates = [
      { x: box.x + 2, y: midY },
      { x: box.x + box.width - 2, y: midY },
    ].filter((p) => isInsideStage(p) && within(box, p) && !isInsideActive(p));

    for (const pick of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const topmost = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const card = el?.closest?.("[data-testid='ffui-carousel-3d-card']");
        return {
          index: card?.getAttribute("data-index") ?? null,
          active: card?.getAttribute("data-active") ?? null,
        };
      }, pick);

      if (topmost.index && topmost.index !== activeIndex && topmost.active !== "true") {
        return true;
      }
    }
    return false;
  };

  // We don't care which adjacent card is visible, only that at least one is.
  for (const card of sideCards) {
    const box = await card.boundingBox();
    if (!box) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await trySamplePoint({ box });
    if (ok) return;
  }

  throw new Error("No adjacent 3D carousel card is visibly peeking outside the active card.");
};

const assertCarouselUsesMostOfQueueHeight = async ({ queuePanel, carouselRoot }) => {
  const queueBox = await queuePanel.boundingBox();
  const carouselBox = await carouselRoot.boundingBox();
  if (!queueBox || !carouselBox) {
    throw new Error("Missing bounding boxes for carousel height verification.");
  }
  const ratio = carouselBox.height / queueBox.height;
  // Guardrail: 3D carousel should fill the queue panel area instead of collapsing to min-height,
  // otherwise users see a large empty region below the carousel.
  if (ratio < 0.72) {
    throw new Error(`3D carousel container height is too small (ratio=${ratio.toFixed(3)}).`);
  }
};

const assertCarouselHintPinnedToBottom = async ({ queuePanel, hint }) => {
  const queueBox = await queuePanel.boundingBox();
  const hintBox = await hint.boundingBox();
  if (!queueBox || !hintBox) {
    throw new Error("Missing bounding boxes for carousel hint verification.");
  }

  const bottomGap = queueBox.y + queueBox.height - (hintBox.y + hintBox.height);
  if (bottomGap > 24) {
    throw new Error(`Carousel hint is not pinned near the bottom (gap=${bottomGap.toFixed(1)}px).`);
  }
};

const main = async () => {
  const outDir = path.join(repoRoot, "tools/docs-screenshots/artifacts/carousel-3d-verification");
  await fs.mkdir(outDir, { recursive: true });

  const captureOne = async ({ baseUrl, viewport, outBase }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport,
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
      await page.screenshot({ path: path.join(outDir, `queue-default-${outBase}.png`), fullPage: false });

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
      await page.screenshot({ path: path.join(outDir, `queue-carousel-3d-${outBase}.png`), fullPage: false });

      const carouselRoot = page.locator("[data-testid='ffui-carousel-3d-container']");
      await waitFor(async () => (await carouselRoot.count()) > 0);

      const activeCard = page.locator("[data-testid='ffui-carousel-3d-card'][data-active='true']");
      const sideCards = [
        page.locator("[data-testid='ffui-carousel-3d-card'][data-index='1']").first(),
        page.locator("[data-testid='ffui-carousel-3d-card'][data-index='2']").first(),
        page.locator("[data-testid='ffui-carousel-3d-card'][data-index='3']").first(),
      ];
      const header = page.locator("[data-testid='ffui-carousel-3d-header']");
      const pagination = page.locator("[data-testid='ffui-carousel-3d-pagination']");
      const stage = page.locator("[data-testid='ffui-carousel-3d-stage']");

      await waitFor(async () => (await activeCard.count()) > 0);
      await waitFor(async () => (await sideCards[0].count()) > 0);
      await waitFor(async () => (await header.count()) > 0);
      await waitFor(async () => (await pagination.count()) > 0);
      await waitFor(async () => (await stage.count()) > 0);

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

      await assert3dCardsAreActuallyVisible({
        page,
        stage: stage.first(),
        activeCard: activeCard.first(),
        sideCards,
      });

      await carouselRoot.screenshot({ path: path.join(outDir, `carousel-3d-container-${outBase}.png`) });
      await pagination.screenshot({ path: path.join(outDir, `carousel-3d-pagination-${outBase}.png`) });

      // Also capture just the main content area
      const mainContent = page.locator("main");
      if ((await mainContent.count()) > 0) {
        await mainContent.screenshot({ path: path.join(outDir, `carousel-3d-main-${outBase}.png`) });
      }

      const queuePanel = page.locator("[data-testid='queue-panel']");
      if ((await queuePanel.count()) > 0) {
        await assertCarouselUsesMostOfQueueHeight({
          queuePanel: queuePanel.first(),
          carouselRoot: carouselRoot.first(),
        });
        await assertCarouselHintPinnedToBottom({
          queuePanel: queuePanel.first(),
          hint: page.locator("[data-testid='ffui-carousel-3d-hint']").first(),
        });
      }

      console.log(`Screenshots saved to: ${outDir}`);
    } finally {
      await browser.close();
    }
  };

  await withDevServer({ startPort: 5173 }, async ({ baseUrl }) => {
    await captureOne({ baseUrl, viewport: { width: 1440, height: 900 }, outBase: "default" });
    await captureOne({ baseUrl, viewport: { width: 2559, height: 1385 }, outBase: "fullscreen" });
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
