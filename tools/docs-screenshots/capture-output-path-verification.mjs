import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, preview } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/output-path-fix/screenshots"));
const withScreenshotApp = async (capture) => {
  process.env.VITE_DOCS_SCREENSHOT_HAS_TAURI = "1";
  process.env.VITE_STARTUP_IDLE_TIMEOUT_MS = "0";
  const buildOptions = { outDir: path.join(output, "app"), emptyOutDir: true };
  const config = {
    root: repoRoot,
    configFile: path.join(repoRoot, "tools/docs-screenshots/vite.config.screenshots.ts"),
    build: buildOptions,
  };
  await build(config);
  const server = await preview({ ...config, preview: { host: "127.0.0.1", port: 0 } });
  try {
    await capture({ baseUrl: server.resolvedUrls.local[0] });
  } finally {
    await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
  }
};
const verifyHeaderLayout = async (page) => {
  const header = page.locator("header").filter({ has: page.getByTestId("ffui-queue-output-settings") });
  assert.ok(await header.evaluate((element) => element.scrollWidth <= element.clientWidth));
  const headerBounds = await header.boundingBox();
  const viewModeBounds = await page.getByTestId("ffui-queue-view-mode-trigger").boundingBox();
  assert.ok(headerBounds && viewModeBounds);
  assert.ok(viewModeBounds.width < headerBounds.width / 2);
  const presetButton = page.getByTestId("ffui-queue-default-preset-trigger");
  const presetBounds = await presetButton.boundingBox();
  assert.ok(presetBounds && presetBounds.width < 180);
  assert.equal(await page.getByTestId("queue-preset-selection-mode").isVisible(), false);
  for (const badge of await page.getByTestId("queue-preset-summary-badge").all()) {
    const bounds = await badge.boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.x + bounds.width <= presetBounds.x + 1);
    assert.ok(Math.abs(bounds.y - presetBounds.y) <= 1);
  }
  const count = page.getByTestId("ffui-queue-job-count");
  assert.ok(
    await count.evaluate((element) => {
      const style = getComputedStyle(element);
      const singleLineHeight =
        parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      return element.getBoundingClientRect().height <= singleLineHeight + 1;
    }),
  );
  const button = await page.getByTestId("ffui-queue-output-settings").boundingBox();
  assert.ok(button);
  for (const badge of await page.getByTestId("ffui-queue-output-container-badge").all()) {
    const bounds = await badge.boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.x + bounds.width <= button.x + 1);
    assert.ok(Math.abs(bounds.y - button.y) <= 1);
  }
};
await fs.mkdir(output, { recursive: true });
await withScreenshotApp(async ({ baseUrl }) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(String(error));
      console.error(error);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("requestfailed", (request) => console.error(request.url(), request.failure()));
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
    const setPresetMode = async (mode, locale) => {
      if (!(await page.getByTestId("queue-preset-settings").isVisible())) {
        await page.getByTestId("ffui-queue-default-preset-trigger").click();
      }
      const trigger = page.getByTestId("queue-preset-selection-mode");
      const label =
        mode === "byMedia"
          ? locale === "zh-CN"
            ? "按输入类型"
            : "By input type"
          : locale === "zh-CN"
            ? "统一预设"
            : "Unified preset";
      if (!(await trigger.textContent()).includes(label)) {
        await trigger.click();
        await page.getByRole("listbox").waitFor();
        await page.getByRole("option", { name: label, exact: true }).press("Enter");
        await page.getByRole("listbox").waitFor({ state: "hidden" });
      }
      await trigger.filter({ hasText: label }).waitFor();
      assert.ok((await trigger.textContent()).includes(label));
    };
    for (const locale of ["zh-CN", "en"]) {
      if (locale === "en") {
        await page.getByTestId("ffui-locale-trigger").click();
        await page.getByTestId("ffui-locale-en").click();
        await page.getByRole("listbox").waitFor({ state: "hidden" });
        await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
        await page.getByTestId("ffui-queue-default-preset-trigger").click();
        for (const kind of ["video", "audio", "image"]) {
          assert.ok((await page.getByTestId(`queue-preset-${kind}-trigger`).textContent()).includes("Follow unified"));
        }
      }
      await setPresetMode("byMedia", locale);
      for (const kind of ["video", "audio", "image"]) {
        const trigger = page.getByTestId(`queue-preset-${kind}-trigger`);
        assert.ok((await trigger.textContent()).includes(locale === "zh-CN" ? "跟随统一预设" : "Follow unified"));
      }
      const selectPreset = async (testId, name) => {
        await page.getByTestId(testId).click();
        await page.getByRole("option", { name, exact: true }).click();
        await page.getByRole("listbox").waitFor({ state: "hidden" });
        assert.equal(await page.getByTestId("queue-preset-settings").isVisible(), true);
      };
      const presetBadges = page.getByTestId("queue-preset-summary-badge");
      await selectPreset("queue-unified-preset-trigger", "Archive Master");
      assert.deepEqual(await presetBadges.allTextContents(), Array(3).fill("Archive Master"));
      await selectPreset("queue-preset-audio-trigger", "Universal 1080p");
      assert.deepEqual(await presetBadges.allTextContents(), ["Archive Master", "Universal 1080p", "Archive Master"]);
      await selectPreset("queue-unified-preset-trigger", "Universal 1080p");
      await selectPreset(
        "queue-preset-audio-trigger",
        locale === "zh-CN" ? "跟随统一预设：Universal 1080p" : "Follow unified: Universal 1080p",
      );
      await page
        .getByTestId("queue-preset-settings")
        .screenshot({ path: path.join(output, `preset-settings-${locale}.png`) });
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByTestId("ffui-queue-default-preset-trigger")
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.getByTestId("ffui-queue-default-preset-trigger").click();
      await page.getByTestId("queue-preset-settings").waitFor();
      await page.getByTestId("ffui-queue-default-preset-trigger").click();
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      await page.getByTestId("ffui-queue-default-preset-trigger").click();
      await page.getByTestId("queue-preset-settings").waitFor();
      await page.locator("header h2").click();
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      await verifyHeaderLayout(page);
      await page
        .locator("header")
        .filter({ has: page.getByTestId("ffui-queue-default-preset-trigger") })
        .screenshot({ path: path.join(output, `preset-routing-${locale}.png`) });
      await setPresetMode("unified", locale);
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      await page.getByTestId("ffui-queue-output-settings").click();
      const dialog = page.getByRole("dialog");
      const mode = dialog.getByTestId("output-policy-container-mode-trigger");
      const force = locale === "zh-CN" ? "按输出类型指定格式" : "Specify formats by output type";
      if (!(await mode.textContent()).includes(force)) {
        await mode.click();
        await page.getByRole("option", { name: force, exact: true }).click();
      }
      for (const [format, label, kind] of [
        ["mkv", "MKV / Matroska (.mkv)", "video"],
        ["mp3", "MP3 (.mp3)", "audio"],
        ["m4a", "M4A (.m4a)", "audio"],
        ["png", "PNG (.png)", "image"],
      ]) {
        const selector = dialog.getByTestId(`output-policy-${kind}-format`).getByRole("combobox");
        await selector.click();
        const wrongKind = kind === "video" ? "MP3 (.mp3)" : "MP4 (.mp4)";
        assert.equal(await page.getByRole("option").filter({ hasText: wrongKind }).count(), 0);
        const option = page.getByRole("option").filter({ hasText: label });
        assert.notEqual(await option.getAttribute("aria-disabled"), "true");
        await option.click();
        assert.ok((await selector.textContent()).includes(label));
        await dialog.screenshot({ path: path.join(output, `format-${format}-${locale}.png`) });
      }
      const guidance = await dialog.getByTestId("output-policy-format-help").textContent();
      assert.ok(guidance.includes(locale === "zh-CN" ? "目标输出类型" : "target output type"));
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.mouse.move(0, 0);
      const badges = page.getByTestId("ffui-queue-output-container-badge");
      assert.equal(await badges.count(), 3);
      assert.deepEqual(await badges.evaluateAll((items) => items.map((item) => item.dataset.mediaKind)), [
        "video",
        "audio",
        "image",
      ]);
      await setPresetMode("byMedia", locale);
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      await verifyHeaderLayout(page);
      for (const width of [1100, 1600]) {
        await page.setViewportSize({ width, height: 850 });
        await verifyHeaderLayout(page);
        await page
          .locator("header")
          .filter({ has: page.getByTestId("ffui-queue-default-preset-trigger") })
          .screenshot({ path: path.join(output, `header-${width}-${locale}.png`) });
      }
      await page.setViewportSize({ width: 1200, height: 850 });
      await page
        .locator("header")
        .filter({ has: page.getByTestId("ffui-queue-output-settings") })
        .screenshot({ path: path.join(output, `media-badges-${locale}.png`) });
      await setPresetMode("unified", locale);
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      await page.getByTestId("ffui-queue-output-settings").click();
      await mode.click();
      await page
        .getByRole("option", { name: locale === "zh-CN" ? "统一指定格式" : "Unified format", exact: true })
        .click();
      const unifiedFormat = dialog.getByTestId("output-policy-container-format").getByRole("combobox");
      await unifiedFormat.click();
      await page.getByRole("option").filter({ hasText: "MP3 (.mp3)" }).click();
      assert.ok((await unifiedFormat.textContent()).includes("MP3 (.mp3)"));
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await badges.count(), 1);
      assert.ok((await badges.textContent()).includes("mp3"));
      await page.getByTestId("ffui-queue-output-settings").click();
      await mode.click();
      await page
        .getByRole("option", {
          name: locale === "zh-CN" ? "默认（走预设/模板）" : "Default (follow preset/template)",
          exact: true,
        })
        .click();
      assert.equal(await dialog.getByTestId("output-policy-audio-format").count(), 0);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.mouse.move(0, 0);
      assert.equal(await badges.count(), 1);
      await verifyHeaderLayout(page);
      await page
        .locator("header")
        .filter({ has: page.getByTestId("ffui-queue-output-settings") })
        .screenshot({ path: path.join(output, `unified-badge-${locale}.png`) });
      if (locale === "zh-CN") await setPresetMode("byMedia", locale);
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
          formats: ["mkv", "mp3", "m4a", "png"],
          isolatedMediaSelectors: true,
          perMediaBadges: 3,
          unifiedBadges: 1,
          unifiedForcedFormat: "mp3",
          inputPresetSelectors: ["video", "audio", "image"],
          presetToolbar:
            "one settings button with adjacent unified or per-input summaries; routing controls in popover",
          headerLayout: "single-line count, compact selector, contained controls and adjacent left-side badges",
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
});
