import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
    baseUrl: "",
    outDir: path.join(repoRoot, "tools/docs-screenshots/artifacts/ui-verification"),
    locale: "zh-CN",
    width: 420,
    height: 1064,
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
    if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-ui-verification.mjs --base-url <URL> [options]",
          "",
          "Options:",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/ui-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 420)",
          "  --height <PX>     Viewport height (default: 1064)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!parsed.baseUrl) {
    throw new Error("--base-url is required (example: http://127.0.0.1:5199/)");
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

const main = async () => {
  const args = parseArgs();
  await fs.mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const url = `${ensureTrailingSlash(args.baseUrl)}?ffuiLocale=${encodeURIComponent(args.locale)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await waitFor(async () => {
      return (await page.locator("[data-testid='ffui-sidebar']").count()) > 0;
    });

    // Ensure we're on Queue so the context menu can be opened from an existing item.
    const queueTab = page.locator("[data-testid='ffui-tab-queue']");
    if ((await queueTab.count()) > 0) {
      await queueTab.click();
    }

    const sidebar = page.locator("[data-testid='ffui-sidebar']");
    await sidebar.screenshot({ path: path.join(args.outDir, `sidebar-${args.locale}.png`) });
    await page.screenshot({ path: path.join(args.outDir, `page-${args.locale}.png`), fullPage: false });

    const jobCard = page.locator("[data-testid='queue-item-card']").first();
    if ((await jobCard.count()) > 0) {
      await jobCard.click({ button: "right" });
      const menu = page.locator("[data-testid='queue-context-menu']");
      await waitFor(async () => (await menu.count()) > 0);
      await menu.screenshot({ path: path.join(args.outDir, `queue-context-menu-${args.locale}.png`) });
      await page.screenshot({
        path: path.join(args.outDir, `queue-context-menu-overlay-${args.locale}.png`),
        fullPage: false,
      });

      const iconCount = await page.evaluate(() => {
        const menuEl = document.querySelector("[data-testid='queue-context-menu']");
        if (!menuEl) return 0;
        return menuEl.querySelectorAll("svg").length;
      });
      if (iconCount === 0) {
        throw new Error("Expected context menu to render lucide icons, but found 0 SVGs.");
      }
    } else {
      throw new Error("Could not find any queue items to open the context menu.");
    }
  } finally {
    await browser.close();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
