import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/ui-verification"),
    locale: "zh-CN",
    width: 960,
    height: 720,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
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
    if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-compare-click-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/ui-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 960)",
          "  --height <PX>     Viewport height (default: 720)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.width) || parsed.width <= 0) {
    throw new Error("--width must be a positive number");
  }
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) {
    throw new Error("--height must be a positive number");
  }
  return parsed;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findOpenPort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });

const waitForHttpOk = async (url, timeoutMs) => {
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
    await sleep(250);
  }
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  const port = await findOpenPort();
  if (!port) {
    throw new Error("Unable to find an open port for the Vite dev server.");
  }

  const baseUrl = `http://127.0.0.1:${port}/`;
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");

  const server = spawn(
    process.execPath,
    [viteBin, "--config", configPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        BROWSER: "none",
        LANG: "en_US.UTF-8",
        VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
      },
      stdio: "inherit",
    },
  );

  const stopServer = async () => {
    server.kill("SIGTERM");
    await sleep(250);
    server.kill("SIGKILL");
  };

  try {
    await waitForHttpOk(baseUrl, 30_000);

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: args.width, height: args.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      const url = `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 30_000 });

      const queueTab = page.getByTestId("ffui-tab-queue");
      if ((await queueTab.count()) > 0) {
        await queueTab.click();
      }

      const card = page.locator("[data-testid='queue-item-card']").first();
      await card.waitFor({ state: "visible", timeout: 30_000 });

      const compareBtn = card.locator("[data-testid='queue-item-compare-button']");
      if ((await compareBtn.count()) === 0) {
        throw new Error("Could not find a compare button on the first queue item card.");
      }

      await compareBtn.click();
      await page.getByTestId("job-compare-timeline").waitFor({ state: "visible", timeout: 30_000 });

      const detailHeader = page.getByTestId("task-detail-header");
      const detailCount = await detailHeader.count();

      const screenshotPath = path.join(args.outDir, `compare-click-${args.locale}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`screenshot: ${screenshotPath}`);

      if (detailCount > 0) {
        throw new Error("Unexpected task detail dialog opened after clicking compare.");
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopServer();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

