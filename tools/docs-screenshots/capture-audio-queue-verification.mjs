import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/audio-queue-feedback/screenshots"));
const contract = JSON.parse(
  await fs.readFile(path.join(repoRoot, "src-tauri/tests/audio-queue-contract.json"), "utf8"),
);
await fs.mkdir(outDir, { recursive: true });

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
      const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
      page.setDefaultTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${baseUrl}?ffuiLocale=zh-CN`, { waitUntil: "commit" });
      await page.getByTestId("ffui-sidebar").waitFor();
      await page.getByTestId("ffui-queue-view-mode-trigger").click();
      await page.getByTestId("ffui-queue-view-mode-detail").click();
      await page.waitForFunction(() => typeof window.__FFUI_TAURI_EVENT_EMIT__ === "function");
      const base = {
        type: "audio",
        source: "manual",
        originalSizeMB: 1,
        presetId: "p1",
        status: "processing",
        progress: 42,
        executionMode: "managed",
        mediaInfo: contract.mediaInfo,
        waitMetadata: { lastProgressPercent: 42, progressEpoch: 1, lastProgressOutTimeSeconds: 50.4 },
        ffmpegCommand: "ffmpeg -i INPUT -c:a aac OUTPUT",
        previewRevision: 1,
      };
      const cover =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=";
      await page.evaluate(
        (jobs) =>
          window.__FFUI_TAURI_EVENT_EMIT__("ffui://queue-state-lite", {
            snapshotRevision: 10,
            latestDeltaRevision: 0,
            jobs,
          }),
        [
          { ...base, id: "audio-plain", filename: "coverless.mp3" },
          { ...base, id: "audio-cover", filename: "covered.mp3", previewPath: cover },
          {
            ...base,
            id: "audio-unknown",
            filename: "analysis.mp3",
            progress: 0,
            executionMode: "transparent",
            waitMetadata: null,
          },
        ],
      );
      const cards = page.getByTestId("queue-item-card");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="queue-item-card"]').length === 3);
      for (const locale of ["zh-CN", "en"]) {
        if (locale === "en") {
          await page.getByTestId("ffui-locale-trigger").click();
          await page.getByTestId("ffui-locale-en").click();
        }
        const plain = cards.filter({ hasText: "coverless.mp3" });
        const covered = cards.filter({ hasText: "covered.mp3" });
        const unknown = cards.filter({ hasText: "analysis.mp3" });
        await plain.getByTestId("queue-audio-placeholder").waitFor();
        assert.ok((await plain.getByTestId("queue-audio-info").textContent()).includes("44.1 kHz"));
        assert.ok(
          (await plain.getByTestId("queue-audio-info").textContent()).includes(
            locale === "en" ? "2 channels" : "2 声道",
          ),
        );
        const thumb = await plain.getByTestId("queue-item-thumbnail").boundingBox();
        assert.equal(thumb.width, thumb.height);
        await covered.getByTestId("queue-item-thumbnail").locator("img").waitFor();
        await covered
          .getByTestId("queue-item-thumbnail")
          .locator("img")
          .evaluate((image) => image.decode());
        assert.equal(await plain.getByTestId("queue-item-progress-indeterminate").count(), 0);
        assert.equal(await unknown.getByTestId("queue-item-progress-bar").count(), 0);
        const cardBox = await unknown.boundingBox();
        const activity = unknown.getByTestId("queue-item-progress-indeterminate");
        assert.equal(
          await unknown
            .getByTestId("queue-item-activity-slot")
            .evaluate((element) => getComputedStyle(element).position),
          "absolute",
        );
        const activityBox = await activity.boundingBox();
        assert.ok(Math.abs(cardBox.y + cardBox.height - activityBox.y - activityBox.height) <= 2);
        assert.equal(await activity.getAttribute("aria-valuenow"), null);
        const animation = await activity.locator("div").evaluate((element) => getComputedStyle(element).animationName);
        assert.ok(animation.includes("queue-activity-travel"));
        await page.screenshot({ path: path.join(outDir, `audio-detail-${locale}.png`) });
      }
      for (const mode of ["compact", "mini", "icon-medium", "carousel-3d"]) {
        await page.getByTestId("ffui-queue-view-mode-trigger").press("ArrowDown");
        await page.getByTestId(`ffui-queue-view-mode-${mode}`).press("Enter");
        await page.getByTestId("queue-audio-info").first().waitFor();
        const info = page.getByTestId("queue-audio-info").first();
        assert.ok((await info.textContent()).includes("44.1 kHz"));
        assert.equal(
          await info.evaluate(
            (element) =>
              element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow !== "ellipsis",
          ),
          false,
        );
        await page.screenshot({ path: path.join(outDir, `audio-${mode}.png`) });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .getByTestId("queue-item-progress-indeterminate")
          .first()
          .locator("div")
          .evaluate((element) => getComputedStyle(element).animationName),
        "none",
      );
      assert.deepEqual(errors, []);
      await fs.writeFile(
        path.join(outDir, "audio-verification.json"),
        JSON.stringify(
          {
            mode: "mock backend UI; real media execution tested in Rust",
            checks: [
              "localized audio metadata",
              "square audio fallback",
              "decoded cover",
              "measured and indeterminate progress",
              "activity at card edge",
              "compact, mini, icon and carousel",
              "reduced motion",
            ],
            result: "passed",
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
    }
  },
);
