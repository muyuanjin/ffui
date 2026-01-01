import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const configPath = path.join(repoRoot, "tools", "docs-screenshots", "vite.config.screenshots.ts");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const takeValue = (args, idx, flag) => {
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    baseUrl: "",
    outDir: path.join(repoRoot, "tools", "docs-screenshots", "artifacts", "preset-footer-stats-verification"),
    locale: "zh-CN",
    width: 720,
    height: 860,
    cardWidth: null,
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
    if (a === "--card-width") {
      parsed.cardWidth = Number(takeValue(args, i, a));
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  node tools/docs-screenshots/capture-preset-footer-stats-verification.mjs [options]",
          "",
          "Options:",
          "  --base-url <URL>  Existing dev server base URL (otherwise a screenshots dev server is started automatically).",
          "  --out-dir <DIR>   Output directory (default: tools/docs-screenshots/artifacts/preset-footer-stats-verification)",
          "  --locale <LOCALE> Locale query param (default: zh-CN)",
          "  --width <PX>      Viewport width (default: 720)",
          "  --height <PX>     Viewport height (default: 860)",
          "  --card-width <PX> Force preset card width (default: unset)",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(parsed.width) || parsed.width <= 0) throw new Error("Invalid --width");
  if (!Number.isFinite(parsed.height) || parsed.height <= 0) throw new Error("Invalid --height");
  if (parsed.cardWidth != null) {
    if (!Number.isFinite(parsed.cardWidth) || parsed.cardWidth <= 0) throw new Error("Invalid --card-width");
    parsed.cardWidth = Math.floor(parsed.cardWidth);
  }
  return parsed;
};

const ensureTrailingSlash = (value) => (value.endsWith("/") ? value : `${value}/`);

const waitFor = async (fn, { timeoutMs = 30_000, intervalMs = 200 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await fn();
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition.");
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
};

const ensureSwitchState = async (dialog, labelText, checked) => {
  const label = dialog.getByText(labelText, { exact: true });
  await label.waitFor({ state: "visible", timeout: 30_000 });
  await label.scrollIntoViewIfNeeded();

  const row = label.locator("..").locator("..");
  const sw = row.locator("[role='switch']").first();
  await sw.waitFor({ state: "visible", timeout: 30_000 });

  const readChecked = async () => {
    const aria = await sw.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    const state = await sw.getAttribute("data-state");
    if (state === "checked") return true;
    if (state === "unchecked") return false;
    return null;
  };

  const currentChecked = await readChecked();
  if (currentChecked === checked) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sw.click({ force: true });
    await waitFor(async () => (await readChecked()) === checked, { timeoutMs: 8000, intervalMs: 100 });
    if ((await readChecked()) === checked) return;
  }

  throw new Error(`Failed to toggle switch "${labelText}" to ${checked ? "on" : "off"}`);
};

const assertFooterNoOverflowNoOverlapNoScrollbars = async (page, card) => {
  const footer = card.getByTestId("preset-card-footer-stats");
  await footer.waitFor({ state: "visible", timeout: 30_000 });

  await page.evaluate(
    (el) => {
      if (!(el instanceof HTMLElement)) throw new Error("footer not found");

      const badOverflows = [];
      const nodes = [el, ...Array.from(el.querySelectorAll("*"))];
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const style = getComputedStyle(node);
        const ox = style.overflowX;
        const oy = style.overflowY;
        const scrollableX = node.scrollWidth > node.clientWidth + 1;
        const scrollableY = node.scrollHeight > node.clientHeight + 1;
        const canScrollX = ox === "auto" || ox === "scroll";
        const canScrollY = oy === "auto" || oy === "scroll";
        if ((canScrollX && scrollableX) || (canScrollY && scrollableY)) {
          badOverflows.push({
            tag: node.tagName,
            ox,
            oy,
            scrollW: node.scrollWidth,
            clientW: node.clientWidth,
            scrollH: node.scrollHeight,
            clientH: node.clientHeight,
            className: node.className,
          });
        }
      }
      if (badOverflows.length > 0) {
        throw new Error(`Unexpected scroll container(s) in footer: ${JSON.stringify(badOverflows.slice(0, 6))}`);
      }

      // Disallow clipping via overflow:hidden if content still exceeds the box.
      // This catches "squeezed out" content even when no scrollbars are shown.
      const badClips = [];
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const style = getComputedStyle(node);
        if (style.overflowX === "hidden" && node.scrollWidth > node.clientWidth + 1) {
          badClips.push({
            tag: node.tagName,
            axis: "x",
            scroll: node.scrollWidth,
            client: node.clientWidth,
            className: node.className,
          });
        }
        if (style.overflowY === "hidden" && node.scrollHeight > node.clientHeight + 1) {
          badClips.push({
            tag: node.tagName,
            axis: "y",
            scroll: node.scrollHeight,
            client: node.clientHeight,
            className: node.className,
          });
        }
      }
      if (badClips.length > 0) {
        throw new Error(`Footer content is clipped: ${JSON.stringify(badClips.slice(0, 6))}`);
      }

      // Element-level scrollbar check (should never be scrollable).
      if (el.scrollWidth > el.clientWidth + 1) {
        throw new Error(`Footer has horizontal overflow: scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`);
      }
      if (el.scrollHeight > el.clientHeight + 1) {
        throw new Error(
          `Footer has vertical overflow: scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`,
        );
      }

      const rootRect = el.getBoundingClientRect();
      const items = Array.from(el.querySelectorAll("[data-footer-item]")).filter((n) => n instanceof HTMLElement);
      const rects = items.map((n) => ({
        key: n.getAttribute("data-footer-item") || "?",
        rect: n.getBoundingClientRect(),
      }));

      for (const { key, rect } of rects) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.left < rootRect.left - 0.5 || rect.right > rootRect.right + 0.5) {
          throw new Error(`Footer item out of bounds: ${key} left=${rect.left} right=${rect.right}`);
        }
        if (rect.top < rootRect.top - 0.5 || rect.bottom > rootRect.bottom + 0.5) {
          throw new Error(`Footer item out of bounds: ${key} top=${rect.top} bottom=${rect.bottom}`);
        }
      }

      const intersects = (a, b) => {
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return { x, y, area: x * y };
      };

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (!a || !b) continue;
          const hit = intersects(a.rect, b.rect);
          if (hit.x > 1 && hit.y > 1 && hit.area > 4) {
            throw new Error(`Footer items overlap: ${a.key} vs ${b.key} (area=${hit.area.toFixed(2)})`);
          }
        }
      }
    },
    await footer.elementHandle(),
  );
};

const capturePresetCard = async (page, outPath) => {
  const card = page.getByTestId("preset-card-root").first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  // Ensure the card is fully within the viewport so element screenshots aren't clipped.
  await page.evaluate(
    (el) => {
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ block: "center", inline: "center" });
    },
    await card.elementHandle(),
  );
  await assertFooterNoOverflowNoOverlapNoScrollbars(page, card);
  await card.screenshot({ path: outPath });
};

const gotoPresetsTab = async (page) => {
  await page.getByTestId("ffui-tab-presets").click({ force: true });
  await waitFor(async () => (await page.locator("[data-testid='preset-panel']").count()) > 0);
  await waitFor(async () => (await page.getByTestId("preset-card-root").count()) > 0);
};

const gotoSettingsTab = async (page) => {
  await page.getByTestId("ffui-tab-settings").click({ force: true });
  await waitFor(async () => (await page.getByTestId("settings-panel").count()) > 0);
  await waitFor(async () => (await page.getByTestId("settings-preset-card-footer").count()) > 0);
};

const captureFlow = async ({ baseUrl, outDir, locale, width, height, cardWidth }) => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    const url = `${ensureTrailingSlash(baseUrl)}?ffuiLocale=${encodeURIComponent(locale)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

    await page.getByTestId("ffui-sidebar").waitFor({ state: "visible", timeout: 30_000 });

    if (typeof cardWidth === "number" && Number.isFinite(cardWidth) && cardWidth > 0) {
      await page.addStyleTag({
        content: `
          [data-testid="preset-card-root"] {
            width: ${cardWidth}px !important;
            min-width: ${cardWidth}px !important;
            max-width: ${cardWidth}px !important;
          }
        `,
      });
    }
    await gotoPresetsTab(page);

    await capturePresetCard(page, path.join(outDir, `twoRows-all-${locale}.png`));

    await gotoSettingsTab(page);
    const footerSection = page.getByTestId("settings-preset-card-footer");
    await footerSection.waitFor({ state: "visible", timeout: 30_000 });

    // Switch to oneRow.
    await footerSection.getByRole("button", { name: "一栏 ↔ 两栏" }).click({ force: true });
    await sleep(250);

    await gotoPresetsTab(page);
    await capturePresetCard(page, path.join(outDir, `oneRow-all-${locale}.png`));

    // Configure a 4-item layout (avgSize + vmaf + data + throughput).
    await gotoSettingsTab(page);
    await footerSection.getByRole("button", { name: "详细设置…" }).click({ force: true });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 30_000 });

    await ensureSwitchState(dialog, "FPS", false);
    await ensureSwitchState(dialog, "已用次数", false);
    await ensureSwitchState(dialog, "平均大小", true);
    await ensureSwitchState(dialog, "VMAF", true);
    await ensureSwitchState(dialog, "数据量", true);
    await ensureSwitchState(dialog, "吞吐量", true);

    await dialog.getByRole("button", { name: "关闭" }).click({ force: true });
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });

    // Capture 4-item layout in oneRow.
    await gotoPresetsTab(page);
    await capturePresetCard(page, path.join(outDir, `oneRow-4items-${locale}.png`));

    // Switch back to twoRows and capture 4-item layout.
    await gotoSettingsTab(page);
    await footerSection.getByRole("button", { name: "一栏 ↔ 两栏" }).click({ force: true });
    await sleep(250);
    await gotoPresetsTab(page);
    await capturePresetCard(page, path.join(outDir, `twoRows-4items-${locale}.png`));
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
      cardWidth: args.cardWidth,
    });
  };

  if (args.baseUrl) {
    await runner({ baseUrl: args.baseUrl });
    return;
  }

  await withViteDevServer(
    {
      repoRoot,
      viteBin,
      configPath,
      env: { LANG: "en_US.UTF-8", VITE_STARTUP_IDLE_TIMEOUT_MS: "0" },
    },
    runner,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
