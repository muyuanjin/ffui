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
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/job-compare-verification"),
    locale: "zh-CN",
    port: 5173,
    width: 980,
    height: 720,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out-dir") {
      parsed.outDir = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--locale") {
      parsed.locale = takeValue(args, i, a);
      i += 1;
      continue;
    }
    if (a === "--port") {
      parsed.port = Number(takeValue(args, i, a));
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
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-job-compare-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/job-compare-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --port <PORT>     Dev server port start (default: 5173)",
          "  --width <PX>      Viewport width (default: 980)",
          "  --height <PX>     Viewport height (default: 720)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.port) || parsed.port <= 0) throw new Error("--port must be a number > 0");
  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error("--width must be a number > 0");
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error("--height must be a number > 0");
  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });

const findOpenPort = async (startPort) => {
  for (let p = startPort; p < startPort + 40; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(p)) return p;
  }
  throw new Error(`Could not find an open port starting from ${startPort}`);
};

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
      // ignore
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
};

const withDevServer = async (fn, options = {}) => {
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
  const port = await findOpenPort(Number(options.port ?? 5173));
  const baseUrl = `http://127.0.0.1:${port}/`;

  const env = {
    ...process.env,
    BROWSER: "none",
    LANG: "en_US.UTF-8",
    // Keep the UI fully hydrated (mirrors capture.mjs defaults).
    VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
  };

  const server = spawn(process.execPath, [viteBin, "--config", configPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  try {
    await waitForHttpOk(baseUrl, 30_000);
    await fn({ baseUrl });
  } finally {
    server.kill("SIGTERM");
    await sleep(250);
    server.kill("SIGKILL");
  }
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  await withDevServer(
    async ({ baseUrl }) => {
      const browser = await chromium.launch();
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
        if ((await queueTab.count()) > 0) await queueTab.click();

        const jobCard = page.getByTestId("queue-item-card").first();
        await jobCard.waitFor({ state: "visible", timeout: 30_000 });
        await jobCard.hover();

        const compareBtn = jobCard.getByTestId("queue-item-compare-button");
        await compareBtn.waitFor({ state: "visible", timeout: 30_000 });
        await compareBtn.click();

        const viewport = page.getByTestId("job-compare-viewport");
        await viewport.waitFor({ state: "visible", timeout: 30_000 });

        await page.screenshot({
          path: path.join(args.outDir, `job-compare-dialog-${args.locale}.png`),
          fullPage: false,
        });
        await viewport.screenshot({
          path: path.join(args.outDir, `job-compare-viewport-${args.locale}.png`),
        });
      } finally {
        await browser.close();
      }
    },
    { port: args.port },
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

