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
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/taskbar-progress-scope-verification"),
    locale: "zh-CN",
    width: 900,
    height: 160,
    port: 5173,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--base-url") {
      parsed.baseUrl = takeValue(args, i, a);
      i += 1;
      continue;
    }
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
    if (a === "--port") {
      parsed.port = Number(takeValue(args, i, a));
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-taskbar-progress-scope-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/taskbar-progress-scope-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 900)",
          "  --height <PX>     Viewport height (default: 160)",
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

const waitFor = async (fn, { timeoutMs = 30000, intervalMs = 50 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await fn();
    if (ok) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await sleep(intervalMs);
  }
};

const getProgressPercent = async (page) => {
  return page.locator("[data-testid='ffui-titlebar-progress']").evaluate((el) => {
    const raw = (el instanceof HTMLElement ? el.style.width : "") || "";
    const parsed = Number.parseFloat(raw.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : null;
  });
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

      const url =
        `${ensureTrailingSlash(baseUrl)}?` +
        `ffuiLocale=${encodeURIComponent(args.locale)}` +
        `&ffuiQueueScenario=${encodeURIComponent("taskbar-progress-scope-serial")}`;

      await page.goto(url, { waitUntil: "domcontentloaded" });

      await waitFor(async () => (await page.locator("[data-testid='ffui-sidebar']").count()) > 0);
      await waitFor(async () => (await page.locator("[data-testid='ffui-titlebar-progress']").count()) > 0);

      // Wait for the GSAP tween to reach the steady-state width.
      await waitFor(
        async () => {
          const percent = await getProgressPercent(page);
          return percent != null && percent >= 45;
        },
        { timeoutMs: 10_000, intervalMs: 50 },
      );

      const percent = await getProgressPercent(page);
      if (percent == null) throw new Error("Failed to read titlebar progress percent.");
      if (percent < 45) throw new Error(`Expected titlebar progress >= 45%, got ${percent}%`);

      const header = page.locator("[data-testid='ffui-titlebar']");
      await header.screenshot({ path: path.join(args.outDir, `titlebar-progress-${args.locale}.png`) });
      await page.screenshot({ path: path.join(args.outDir, `page-${args.locale}.png`), fullPage: false });
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
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
