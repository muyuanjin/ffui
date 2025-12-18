import path from "node:path";
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import fs from "node:fs/promises";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "startup-locale");
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
    await waitForHttpOk(baseUrl, 30_000);
    await fn({ baseUrl });
  } finally {
    server.kill("SIGTERM");
    await sleep(250);
    server.kill("SIGKILL");
  }
};

const captureOne = async ({ baseUrl, label, locale }) => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 420, height: 1064 },
      deviceScaleFactor: 1,
      locale,
    });
    const page = await context.newPage();

    // Important: do NOT pass ffuiLocale; this validates the startup detection path.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 30_000 });

    await page.screenshot({ path: path.join(outDir, `page-auto-${label}.png`), fullPage: false });
    await page.getByTestId("ffui-sidebar").screenshot({
      path: path.join(outDir, `sidebar-auto-${label}.png`),
    });
  } finally {
    await browser.close();
  }
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });

  await withDevServer(async ({ baseUrl }) => {
    await captureOne({ baseUrl, label: "zh-CN", locale: "zh-CN" });
  });

  await withDevServer(async ({ baseUrl }) => {
    await captureOne({ baseUrl, label: "en", locale: "en-US" });
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
