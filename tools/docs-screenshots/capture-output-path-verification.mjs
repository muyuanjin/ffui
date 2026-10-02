import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/output-path-fix/screenshots"));
await fs.mkdir(output, { recursive: true });
await withViteDevServer(
  {
    repoRoot,
    viteBin: path.join(repoRoot, "node_modules/vite/bin/vite.js"),
    configPath: path.join(repoRoot, "tools/docs-screenshots/vite.config.screenshots.ts"),
    env: { VITE_DOCS_SCREENSHOT_HAS_TAURI: "1", VITE_STARTUP_IDLE_TIMEOUT_MS: "0" },
  },
  async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
      page.setDefaultTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.addInitScript(() => {
        window.__FFUI_COPIED_PATH__ = "previous-input-path";
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.__FFUI_COPIED_PATH__ = value;
            },
          },
        });
      });
      await page.goto(`${baseUrl}?ffuiLocale=zh-CN`, { waitUntil: "commit" });
      await page.getByTestId("ffui-sidebar").waitFor();
      for (const locale of ["zh-CN", "en"]) {
        if (locale === "en") {
          await page.getByTestId("ffui-locale-trigger").click();
          await page.getByTestId("ffui-locale-en").click();
        }
        await page.getByTestId("ffui-queue-output-settings").click();
        const dialog = page.getByRole("dialog");
        const mode = dialog.getByTestId("output-policy-container-mode-trigger");
        const force = locale === "zh-CN" ? "指定格式" : "Force format";
        if (!(await mode.textContent()).includes(force)) {
          await mode.click();
          await page.getByRole("option", { name: force, exact: true }).click();
        }
        for (const [format, label] of [
          ["mp3", "MP3 (.mp3)"],
          ["m4a", "M4A (.m4a)"],
          ["png", "PNG (.png)"],
        ]) {
          await dialog.getByRole("combobox").nth(1).click();
          const option = page.getByRole("option").filter({ hasText: label });
          assert.notEqual(await option.getAttribute("aria-disabled"), "true");
          await option.click();
          assert.ok((await dialog.getByRole("combobox").nth(1).textContent()).includes(label));
          await dialog.screenshot({ path: path.join(output, `format-${format}-${locale}.png`) });
        }
        const guidance = await dialog.getByTestId("output-policy-format-help").textContent();
        assert.ok(guidance.includes(locale === "zh-CN" ? "仅改变输出扩展名" : "extension only"));
        await page.keyboard.press("Escape");
      }
      await page.getByTestId("ffui-queue-view-mode-trigger").click();
      await page.getByTestId("ffui-queue-view-mode-detail").click();
      await page.waitForFunction(() => typeof window.__FFUI_TAURI_EVENT_EMIT__ === "function");
      await page.evaluate(() =>
        window.__FFUI_TAURI_EVENT_EMIT__("ffui://queue-state-lite", {
          snapshotRevision: 10,
          latestDeltaRevision: 0,
          jobs: [
            {
              id: "known",
              filename: "known-template.flac",
              inputPath: "C:/素材/known-template.flac",
              outputPath: "D:/输出/known-template.mp3",
            },
            { id: "unknown", filename: "analysis.wav", inputPath: "C:/素材/analysis.wav" },
          ].map((job) => ({
            ...job,
            type: "audio",
            source: "manual",
            presetId: "p1",
            originalSizeMB: 1,
            status: "completed",
            progress: 100,
            executionMode: "transparent",
          })),
        }),
      );
      const known = page.getByTestId("queue-item-card").filter({ hasText: "known-template.flac" });
      await known.click({ button: "right" });
      const copy = page.getByTestId("queue-context-menu-copy-output");
      assert.notEqual(await copy.getAttribute("aria-disabled"), "true");
      assert.notEqual(await page.getByTestId("queue-context-menu-open-output").getAttribute("aria-disabled"), "true");
      await page.getByTestId("queue-context-menu").screenshot({ path: path.join(output, "known-output-menu.png") });
      await copy.click();
      await page.waitForFunction(() => window.__FFUI_COPIED_PATH__ === "D:/输出/known-template.mp3");
      await page.getByTestId("queue-item-card").filter({ hasText: "analysis.wav" }).click({ button: "right" });
      const unknownCopy = page.getByTestId("queue-context-menu-copy-output");
      assert.equal(await unknownCopy.getAttribute("aria-disabled"), "true");
      assert.equal(await page.getByTestId("queue-context-menu-open-output").getAttribute("aria-disabled"), "true");
      await unknownCopy.dispatchEvent("click");
      assert.equal(await page.evaluate(() => window.__FFUI_COPIED_PATH__), "D:/输出/known-template.mp3");
      await page.getByTestId("queue-context-menu").screenshot({ path: path.join(output, "unknown-output-menu.png") });
      assert.deepEqual(errors, []);
      await fs.writeFile(
        path.join(output, "verification.json"),
        JSON.stringify(
          {
            formats: ["mp3", "m4a", "png"],
            locales: ["zh-CN", "en"],
            knownOutputCopied: true,
            unknownOutputDisabled: true,
            ipc: "mocked",
          },
          null,
          2,
        ),
      );
      await page.close();
    } finally {
      await browser.close();
    }
  },
);
