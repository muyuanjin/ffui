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
    outDir: path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "settings-data-storage"),
    locale: "en",
    width: 520,
    height: 980,
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
          "  node tools/docs-screenshots/capture-settings-data-storage-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/settings-data-storage)",
          "  --locale <LOCALE> Initial locale query param (default: en)",
          "  --width <PX>      Viewport width (default: 520)",
          "  --height <PX>     Viewport height (default: 980)",
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

const expectTextIncludes = async (locator, expected, label) => {
  const text = ((await locator.textContent()) ?? "").trim();
  if (!text.includes(expected)) {
    throw new Error(`${label} expected to include "${expected}", but got: "${text}"`);
  }
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

      await page.goto(`${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });

      await page.waitForSelector("[data-testid='ffui-sidebar']", { timeout: 90_000 });
      await page.evaluate(() => {
        const el = document.querySelector("[data-testid='ffui-tab-settings']");
        if (!(el instanceof HTMLElement)) throw new Error("Missing settings tab element.");
        el.click();
      });
      await page.waitForSelector("[data-testid='settings-panel']", { timeout: 90_000 });

      const section = page.locator("[data-testid='settings-data-storage']");
      await section.scrollIntoViewIfNeeded();

      const status = page.locator("[data-testid='settings-data-root-status']");

      await page.locator("[data-testid='settings-data-root-open']").click();
      await expectTextIncludes(status, "Desktop app required", "Open action");

      await page.locator("[data-testid='settings-data-root-export']").click();
      await expectTextIncludes(status, "Desktop app required", "Export action");

      await page.locator("[data-testid='settings-data-root-import']").click();
      await expectTextIncludes(status, "Desktop app required", "Import action");

      await page.locator("[data-testid='settings-data-root-clear']").click();
      await expectTextIncludes(status, "Desktop app required", "Clear action");

      await section.screenshot({ path: path.join(args.outDir, `data-storage-${args.locale}.png`) });
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
