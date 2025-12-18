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
    outDir: path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "onboarding-wizard-verification"),
    locale: "zh-CN",
    width: 1240,
    height: 820,
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
          "  node tools/docs-screenshots/capture-onboarding-wizard-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/onboarding-wizard-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 1240)",
          "  --height <PX>     Viewport height (default: 820)",
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

const captureFlow = async ({ baseUrl, outDir, locale, width, height }) => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const url = `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(locale)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await waitFor(async () => (await page.locator("[data-testid='ffui-sidebar']").count()) > 0);

    const presetsTab = page.locator("[data-testid='ffui-tab-presets']");
    await waitFor(async () => (await presetsTab.count()) > 0);
    await presetsTab.click({ force: true });
    await waitFor(async () => (await page.locator("[data-testid='preset-panel']").count()) > 0);

    const openWizardButton = page.locator("[data-testid='preset-import-recommended-pack']");
    await waitFor(async () => (await openWizardButton.count()) > 0);
    await openWizardButton.click({ force: true });

    const wizard = page.locator("[data-testid='preset-setup-wizard']");
    await waitFor(async () => (await wizard.count()) > 0);
    await wizard.screenshot({ path: path.join(outDir, `wizard-welcome-${locale}.png`) });

    const next = page.locator("[data-testid='preset-setup-wizard-next']");
    await waitFor(async () => (await next.count()) > 0);

    await next.click({ force: true });
    const codecStep = page.locator("[data-testid='preset-setup-wizard-step-codec']");
    await waitFor(async () => (await codecStep.count()) > 0);
    await wizard.screenshot({ path: path.join(outDir, `wizard-codec-${locale}.png`) });

    await next.click({ force: true });
    const useCaseStep = page.locator("[data-testid='preset-setup-wizard-step-useCase']");
    await waitFor(async () => (await useCaseStep.count()) > 0);
    await wizard.screenshot({ path: path.join(outDir, `wizard-useCase-${locale}.png`) });

    await next.click({ force: true });
    const presetsStep = page.locator("[data-testid='preset-setup-wizard-step-presets']");
    await waitFor(async () => (await presetsStep.count()) > 0);
    await waitFor(async () => (await page.locator("[data-testid='preset-setup-wizard-preset-card']").count()) > 0);
    await wizard.screenshot({ path: path.join(outDir, `wizard-presets-${locale}.png`) });
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  const runner = async ({ baseUrl }) => {
    await captureFlow({
      baseUrl,
      outDir: args.outDir,
      locale: args.locale,
      width: args.width,
      height: args.height,
    });
  };

  if (args.baseUrl) {
    await runner({ baseUrl: args.baseUrl });
    return;
  }

  await withDevServer({ startPort: args.port }, runner);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
