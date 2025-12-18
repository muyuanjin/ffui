import path from "node:path";
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    outDir: path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "empty-queue-badge"),
    width: 560,
    height: 520,
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
          "  node tools/docs-screenshots/capture-empty-queue-badge-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/empty-queue-badge)",
          "  --width <PX>      Viewport width (default: 560)",
          "  --height <PX>     Viewport height (default: 520)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return parsed;
};

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

const withDevServer = async (fn) => {
  const port = await findOpenPort(5173);
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
    await waitForHttpOk(baseUrl);
    await fn({ baseUrl });
  } finally {
    server.kill("SIGTERM");
    await sleep(250);
    server.kill("SIGKILL");
  }
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const assertBadgeContainsLabel = async (page) => {
  const badge = page.locator("[data-testid='ffui-empty-queue-badge']");
  const label = page.locator("[data-testid='ffui-empty-queue-badge-label']");

  await badge.waitFor({ state: "visible", timeout: 90_000 });
  await label.waitFor({ state: "visible", timeout: 90_000 });

  const badgeBox = await badge.boundingBox();
  const labelBox = await label.boundingBox();

  if (!badgeBox || !labelBox) {
    throw new Error("Unable to compute badge/label bounding boxes.");
  }

  const eps = 0.5;
  const withinLeft = labelBox.x + eps >= badgeBox.x;
  const withinRight = labelBox.x + labelBox.width <= badgeBox.x + badgeBox.width + eps;
  if (!withinLeft || !withinRight) {
    throw new Error(
      `Queue badge label overflow detected: badge=${JSON.stringify(badgeBox)} label=${JSON.stringify(labelBox)}`,
    );
  }

  return { badge, label };
};

const captureLocale = async (page, baseUrl, locale, outDir) => {
  await page.goto(`${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(locale)}&ffuiQueueScenario=empty`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForSelector("[data-testid='queue-panel']", { timeout: 90_000 });

  const { badge } = await assertBadgeContainsLabel(page);

  await badge.screenshot({ path: path.join(outDir, `empty-queue-badge-${locale}.png`) });
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  await withDevServer(async ({ baseUrl }) => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: args.width, height: args.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await captureLocale(page, baseUrl, "zh-CN", args.outDir);
      await captureLocale(page, baseUrl, "en", args.outDir);
    } finally {
      await browser.close();
    }
  });
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
