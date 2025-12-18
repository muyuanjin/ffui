import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
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
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/preview-inflight-source-safety"),
    locale: "en",
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
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-preview-inflight-source-safety.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory",
          "  --locale <LOCALE> Locale query param (default: en)",
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
    VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
  };

  const server = spawn(
    process.execPath,
    [viteBin, "--config", configPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    },
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

        const url =
          `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}` +
          `&ffuiQueueScenario=${encodeURIComponent("taskbar-progress-scope-serial")}`;

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.locator("[data-testid='ffui-sidebar']").waitFor({ state: "visible", timeout: 60_000 });

        const queueTab = page.locator("[data-testid='ffui-tab-queue']");
        if ((await queueTab.count()) > 0) {
          await queueTab.click({ force: true });
        }

        const processingCard = page
          .locator("[data-testid='queue-item-card']")
          .filter({ has: page.locator("[data-testid='queue-item-status-label']", { hasText: "processing" }) })
          .first();

        await processingCard.waitFor({ state: "visible", timeout: 60_000 });
        await processingCard.locator("[data-testid='queue-item-thumbnail']").click({ force: true });

        const dialog = page.locator("[data-testid='expanded-preview-dialog']");
        await dialog.waitFor({ state: "visible", timeout: 30_000 });

        const badge = page.locator("[data-testid='expanded-preview-source-badge']");
        await badge.waitFor({ state: "visible", timeout: 30_000 });
        const badgeText = (await badge.innerText().catch(() => "")).trim();
        if (!badgeText.includes("Input")) {
          throw new Error(`Expected preview source badge to contain "Input", got "${badgeText}"`);
        }

        await sleep(300);
        await dialog.screenshot({ path: path.join(args.outDir, `preview-${args.locale}-processing-default.png`) });
      } finally {
        await browser.close();
      }
    },
    { port: args.port },
  );
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
