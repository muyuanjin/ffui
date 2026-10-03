import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, preview } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/output-path-fix/screenshots"));
const longPresetName = "MP3 高品质音频提取 / High quality audio extraction with loudness normalization and metadata";
const backgroundChannels = async (locator) =>
  locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
const verifyBlueAccent = async (locator) => {
  const channels = await backgroundChannels(locator);
  assert.ok(channels[2] > channels[0] + 40 && channels[1] > channels[0] + 20, `Expected blue: ${channels}`);
};
const verifyWarmAccent = async (locator) => {
  const channels = await backgroundChannels(locator);
  assert.ok(channels[0] > channels[2] + 30 && channels[1] > channels[2] + 15, `Expected warm: ${channels}`);
};
const verifyNestedFormatDismissal = async (page, dialog, kind, method, touch = false) => {
  const selector = dialog.getByTestId(`output-policy-${kind}-format`).getByRole("combobox");
  const original = await selector.textContent();
  const dialogBounds = method === "blank" ? await dialog.boundingBox() : null;
  if (method === "blank") assert.ok(dialogBounds);
  if (touch) await selector.tap();
  else await selector.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor();
  await listbox.click({ trial: true });
  if (method === "escape") {
    await page.keyboard.press("Escape");
  } else {
    let point = { x: 6, y: 6 };
    if (dialogBounds) {
      const menuBounds = await listbox.boundingBox();
      assert.ok(menuBounds);
      const blankPoint = [
        { x: dialogBounds.x + 16, y: dialogBounds.y + dialogBounds.height - 16 },
        { x: dialogBounds.x + dialogBounds.width - 16, y: dialogBounds.y + dialogBounds.height - 16 },
        { x: dialogBounds.x + 16, y: dialogBounds.y + 16 },
      ].find(
        (candidate) =>
          candidate.x < menuBounds.x ||
          candidate.x > menuBounds.x + menuBounds.width ||
          candidate.y < menuBounds.y ||
          candidate.y > menuBounds.y + menuBounds.height,
      );
      assert.ok(blankPoint, `No blank dialog point outside ${kind} menu`);
      point = blankPoint;
    }
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  }
  await listbox.waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await selector.textContent(), original);
  assert.equal(await selector.evaluate((element) => element === document.activeElement), true);
};
const withScreenshotApp = async (capture) => {
  process.env.VITE_DOCS_SCREENSHOT_HAS_TAURI = "1";
  process.env.VITE_STARTUP_IDLE_TIMEOUT_MS = "0";
  const buildOptions = { outDir: path.join(output, "app"), emptyOutDir: true };
  const config = {
    root: repoRoot,
    configFile: path.join(repoRoot, "tools/docs-screenshots/vite.config.screenshots.ts"),
    build: buildOptions,
    plugins: [
      {
        name: "ffui-queue-preset-fixture",
        enforce: "pre",
        transform(code, id) {
          if (!id.replaceAll("\\", "/").endsWith("/tools/docs-screenshots/mocks/backend.ts")) return;
          const name = 'name: "Fast Preview"';
          assert.ok(code.includes(name));
          return code.replace(name, `name: ${JSON.stringify(longPresetName)}`);
        },
      },
    ],
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
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
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
  const outputButton = page.getByTestId("ffui-queue-output-settings");
  const styling = (element) => {
    const styles = getComputedStyle(element);
    return [styles.height, styles.borderRadius, styles.fontWeight, styles.fontSize];
  };
  assert.deepEqual(await presetButton.evaluate(styling), await outputButton.evaluate(styling));
  await verifyBlueAccent(presetButton);
  await verifyWarmAccent(outputButton);
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
const verifyPresetHover = async (page) => {
  const trigger = page.getByTestId("ffui-queue-default-preset-trigger");
  const panel = page.getByTestId("queue-preset-settings");
  const outside = page.getByTestId("ffui-queue-view-mode-trigger");
  await page.mouse.move(0, 0);
  await outside.focus();
  await page.getByTestId("queue-preset-summary-badge").first().hover();
  await panel.waitFor();
  assert.equal(await outside.evaluate((element) => element === document.activeElement), true);
  await panel.hover({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(400);
  assert.equal(await panel.isVisible(), true);
  await page.mouse.move(0, 0);
  await panel.waitFor({ state: "hidden" });
  assert.equal(await outside.evaluate((element) => element === document.activeElement), true);
  await trigger.hover();
  await panel.waitFor();
  await page.waitForTimeout(250);
  await verifyBlueAccent(trigger);
  await verifyBlueAccent(panel.locator('[role="radio"][data-state="checked"]'));
  await trigger.click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  assert.equal(await panel.isVisible(), true);
  await page.getByTestId("queue-preset-mode-byMedia").click();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await panel.waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.hover();
  await panel.waitFor();
  await trigger.click();
  await page.getByTestId("queue-unified-preset-trigger").click();
  await page.getByRole("listbox").waitFor();
  await page.getByRole("option").first().click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.hover();
  await panel.waitFor();
  await page.getByTestId("queue-unified-preset-trigger").click();
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await trigger.hover();
  await panel.waitFor();
  await trigger.click();
  await outside.focus();
  await panel.waitFor({ state: "hidden" });
  assert.equal(await outside.evaluate((element) => element === document.activeElement), true);
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
        await page.mouse.move(0, 0);
        await page.getByTestId("queue-preset-summary").hover();
        await page.getByTestId("queue-preset-settings").waitFor();
      }
      const label =
        mode === "byMedia"
          ? locale === "zh-CN"
            ? "按输入类型"
            : "By input type"
          : locale === "zh-CN"
            ? "统一预设"
            : "Unified preset";
      const radio = page.getByRole("radio", { name: label, exact: true });
      if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
      assert.equal(await radio.getAttribute("aria-checked"), "true");
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
        await page.keyboard.press("Escape");
        await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      }
      assert.equal(
        await page
          .getByTestId("ffui-queue-default-preset-trigger")
          .textContent()
          .then((text) => text.trim()),
        locale === "zh-CN" ? "参数设置" : "Parameter settings",
      );
      const settingsLabel = locale === "zh-CN" ? "参数设置" : "Parameter settings";
      assert.equal(await page.getByTestId("ffui-queue-default-preset-trigger").getAttribute("title"), settingsLabel);
      await verifyPresetHover(page);
      await setPresetMode("byMedia", locale);
      assert.equal((await page.getByTestId("queue-preset-settings-title").textContent()).trim(), settingsLabel);
      assert.equal(await page.getByTestId("queue-preset-selection-mode").getAttribute("aria-label"), settingsLabel);
      for (const kind of ["video", "audio", "image"]) {
        const trigger = page.getByTestId(`queue-preset-${kind}-trigger`);
        assert.ok((await trigger.textContent()).includes(locale === "zh-CN" ? "跟随统一预设" : "Follow unified"));
      }
      const selectPreset = async (testId, name) => {
        await page.getByTestId(testId).click();
        await page.getByRole("listbox").waitFor();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        assert.equal(await page.getByTestId("queue-preset-settings").isVisible(), true);
        await page.getByRole("option", { name, exact: true }).click();
        await page.getByRole("listbox").waitFor({ state: "hidden" });
        assert.equal(await page.getByTestId("queue-preset-settings").isVisible(), true);
      };
      const presetBadges = page.getByTestId("queue-preset-summary-badge").locator(".truncate");
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
      for (const kind of ["video", "audio", "image"]) {
        for (const method of ["overlay", "blank", "escape"]) {
          await verifyNestedFormatDismissal(page, dialog, kind, method);
        }
        await dialog.screenshot({ path: path.join(output, `cancelled-format-${kind}-${locale}.png`) });
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
      await setPresetMode("byMedia", locale);
      for (const kind of ["video", "audio", "image"]) {
        await selectPreset(`queue-preset-${kind}-trigger`, longPresetName);
        const text = page.getByTestId(`queue-preset-${kind}-trigger`).locator("span").first();
        assert.equal(await text.textContent(), longPresetName);
        assert.equal(
          await text.evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
          ),
          true,
        );
      }
      await page
        .getByTestId("queue-preset-settings")
        .screenshot({ path: path.join(output, `long-preset-settings-${locale}.png`) });
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
      for (const width of [1100, 1600]) {
        await page.setViewportSize({ width, height: 850 });
        await verifyHeaderLayout(page);
        await page
          .locator("header")
          .filter({ has: page.getByTestId("ffui-queue-default-preset-trigger") })
          .screenshot({ path: path.join(output, `header-${width}-${locale}.png`) });
      }
      await page.setViewportSize({ width: 1200, height: 850 });
      await setPresetMode("byMedia", locale);
      for (const kind of ["video", "audio", "image"]) {
        await selectPreset(
          `queue-preset-${kind}-trigger`,
          locale === "zh-CN" ? "跟随统一预设：Universal 1080p" : "Follow unified: Universal 1080p",
        );
      }
      await page.keyboard.press("Escape");
      await page.getByTestId("queue-preset-settings").waitFor({ state: "hidden" });
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
          { id: "queued", filename: "queued-audio.mp3", inputPath: "C:/素材/queued-audio.mp3", status: "queued" },
        ].map((job) => ({
          ...job,
          type: "audio",
          source: "manual",
          presetId: "p1",
          originalSizeMB: 1,
          status: job.status ?? "completed",
          progress: job.status === "queued" ? 0 : 100,
          executionMode: "transparent",
        })),
      }),
    );
    const queued = page.getByTestId("queue-item-card").filter({ hasText: "queued-audio.mp3" });
    const indicator = queued.getByTestId("queue-item-status-indicator");
    await indicator.waitFor();
    assert.equal(await indicator.evaluate((element) => element.tagName), "SPAN");
    const statusSnapshots = [];
    for (const [locale, name] of [
      ["en", "queued"],
      ["zh-CN", "排队中"],
      ["en", "queued"],
    ]) {
      await page.getByTestId("ffui-locale-trigger").click();
      await page.getByTestId(`ffui-locale-${locale}`).click();
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      const namedIndicator = queued.getByRole("img", { name, exact: true });
      await namedIndicator.waitFor();
      assert.equal(await namedIndicator.count(), 1);
      const snapshot = await namedIndicator.ariaSnapshot();
      assert.ok(snapshot.includes(`img "${name}"`));
      statusSnapshots.push({ locale, name, snapshot });
    }
    const centerDifference = await indicator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const dots = [...element.querySelectorAll("circle")].map((dot) => dot.getBoundingClientRect());
      return {
        count: dots.length,
        horizontal:
          (Math.min(...dots.map((dot) => dot.left)) + Math.max(...dots.map((dot) => dot.right))) / 2 -
          (bounds.left + bounds.right) / 2,
        vertical: dots.map((dot) => (dot.top + dot.bottom) / 2 - (bounds.top + bounds.bottom) / 2),
      };
    });
    assert.equal(centerDifference.count, 3);
    assert.ok(Math.abs(centerDifference.horizontal) < 0.5);
    assert.ok(centerDifference.vertical.every((difference) => Math.abs(difference) < 0.5));
    await queued.screenshot({ path: path.join(output, "queued-audio-centered-status.png") });
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
    const touchPage = await browser.newPage({ viewport: { width: 1100, height: 850 }, hasTouch: true });
    await touchPage.goto(`${baseUrl}?ffuiLocale=en`, { waitUntil: "commit" });
    const touchTrigger = touchPage.getByTestId("ffui-queue-default-preset-trigger");
    const touchPanel = touchPage.getByTestId("queue-preset-settings");
    await touchTrigger.tap();
    await touchPanel.waitFor();
    await touchTrigger.tap();
    await touchPanel.waitFor({ state: "hidden" });
    await touchPage.getByTestId("ffui-queue-output-settings").tap();
    const touchDialog = touchPage.getByRole("dialog");
    await touchDialog.getByTestId("output-policy-container-mode-trigger").tap();
    await touchPage.getByRole("option", { name: "Specify formats by output type", exact: true }).tap();
    for (const kind of ["video", "audio", "image"]) {
      await verifyNestedFormatDismissal(touchPage, touchDialog, kind, "overlay", true);
    }
    await touchPage.touchscreen.tap(6, 6);
    await touchDialog.waitFor({ state: "hidden" });
    await touchPage.close();
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
          hover: "opens without stealing focus; crossing the gap keeps it open; leaving closes unpinned content",
          interactions:
            "hover then click pins; keyboard Enter opens; nested Select portals stay open; Escape restores focus; outside and same-trigger dismissal",
          longPresetNames: "complete wrapped names in panel; bounded summaries at 1100 and 1600 pixels",
          touch: "button tap opens and a second tap closes",
          outputFormatDismissal:
            "video/audio/image menus cancel on overlay, blank-content and Escape without closing settings or changing values; touch tap cancels only the menu; focus returns to its trigger",
          queuedStatusCenter: centerDifference,
          queuedStatusAccessibility: statusSnapshots,
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
