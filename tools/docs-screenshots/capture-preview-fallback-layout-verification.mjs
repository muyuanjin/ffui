import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const takeValue = (args, idx, flag) => {
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/preview-fallback-layout"),
    locale: "zh-CN",
    width: 980,
    height: 720,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") continue;
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
          "  node tools/docs-screenshots/capture-preview-fallback-layout-verification.mjs [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 980)",
          "  --height <PX>     Viewport height (default: 720)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error("--width must be a number > 0");
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error("--height must be a number > 0");
  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pad2 = (n) => String(n).padStart(2, "0");

const formatTimestamp = (date) => {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
};

const resolveUniquePath = async (desiredPath) => {
  try {
    const st = await fs.stat(desiredPath);
    if (st.isFile()) {
      const ext = path.extname(desiredPath);
      const base = desiredPath.slice(0, -ext.length);
      return `${base}-${formatTimestamp(new Date())}${ext}`;
    }
  } catch {
    // Not existing, ok.
  }
  return desiredPath;
};

const assertComputedStyleIs = async (locator, property, expected) => {
  const actual = await locator.evaluate((el, p) => window.getComputedStyle(el)[p], property);
  if (String(actual).trim() !== expected) {
    throw new Error(`Expected computed ${property} to be "${expected}", got "${actual}"`);
  }
};

const shouldIgnorePageError = (message) => {
  const text = String(message ?? "");
  return text.includes("Not allowed to load local resource:");
};

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  await withViteDevServer(
    {
      repoRoot,
      viteBin,
      configPath,
      env: {
        LANG: "en_US.UTF-8",
        VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
        VITE_DOCS_SCREENSHOT_HAS_TAURI: "1",
      },
    },
    async ({ baseUrl }) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: args.width, height: args.height },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();

        const errors = [];
        page.on("pageerror", (err) => {
          const message = String(err?.message ?? err);
          if (shouldIgnorePageError(message)) return;
          errors.push(message);
        });
        page.on("console", (msg) => {
          if (msg.type() !== "error") return;
          const text = msg.text();
          if (shouldIgnorePageError(text)) return;
          errors.push(text);
        });

        const url =
          `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}` +
          `&ffuiQueueScenario=${encodeURIComponent("taskbar-progress-scope-serial")}`;

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 90_000 });

        await page.getByTestId("ffui-tab-queue").click({ force: true });
        await page.getByTestId("queue-item-thumbnail").first().waitFor({ state: "visible", timeout: 90_000 });

        await page.getByTestId("queue-item-thumbnail").first().click({ force: true });
        const dialog = page.getByTestId("expanded-preview-dialog");
        await dialog.waitFor({ state: "visible", timeout: 60_000 });

        const fallback = page.getByTestId("fallback-media-preview");
        try {
          await fallback.waitFor({ state: "visible", timeout: 5_000 });
        } catch {
          const video = page.getByTestId("task-detail-expanded-video");
          await video.waitFor({ state: "visible", timeout: 60_000 });
          await video.dispatchEvent("error");
          await fallback.waitFor({ state: "visible", timeout: 60_000 });
        }

        const surface = page.getByTestId("expanded-preview-surface");
        await assertComputedStyleIs(surface, "overflowY", "auto");
        await assertComputedStyleIs(surface, "overflowX", "hidden");
        await assertComputedStyleIs(fallback, "overflowY", "auto");

        await sleep(300);
        const screenshotPath = await resolveUniquePath(path.join(args.outDir, `preview-fallback-${args.locale}.png`));
        await dialog.screenshot({ path: screenshotPath });

        if (errors.length > 0) {
          throw new Error(`Page emitted console/page errors:\n${errors.join("\n")}`);
        }
      } finally {
        await browser.close();
      }
    },
  );
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
