import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/media-playback-fix/screenshots"));
const fixtures = path.resolve(process.argv[3] ?? path.join(repoRoot, ".cache/media-playback-fix/browser-fixtures"));
const served = path.join(repoRoot, ".cache/docs-screenshots/__local_tmp");
await fs.mkdir(output, { recursive: true });
await fs.mkdir(served, { recursive: true });
for (const filename of [
  "audio-preview.m4a",
  "image-preview.png",
  "media-preview-audio.mkv",
  "media-preview-image.tiff",
]) {
  await fs.copyFile(path.join(fixtures, filename), path.join(served, filename));
}

await withViteDevServer(
  {
    repoRoot,
    viteBin: path.join(repoRoot, "node_modules/vite/bin/vite.js"),
    configPath: path.join(repoRoot, "tools/docs-screenshots/vite.config.screenshots.ts"),
    env: {
      VITE_DOCS_SCREENSHOT_HAS_TAURI: "1",
      VITE_STARTUP_IDLE_TIMEOUT_MS: "0",
      VITE_DOCS_SCREENSHOT_COMPATIBLE_AUDIO_PREVIEW: "/docs-screenshots/__local_tmp/audio-preview.m4a",
      VITE_DOCS_SCREENSHOT_COMPATIBLE_IMAGE_PREVIEW: "/docs-screenshots/__local_tmp/image-preview.png",
    },
  },
  async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true });
    const verifyPage = async () => {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      page.setDefaultTimeout(60_000);
      const errors = [];
      const pending = new Set();
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Not allowed to load local resource"))
          errors.push(message.text());
      });
      page.on("request", (request) => pending.add(request.url()));
      page.on("requestfinished", (request) => pending.delete(request.url()));
      page.on("requestfailed", (request) => {
        pending.delete(request.url());
        errors.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      await page.goto(`${baseUrl}?ffuiLocale=zh-CN`, { waitUntil: "commit" });
      try {
        await page.getByTestId("ffui-sidebar").waitFor();
      } catch (failure) {
        await fs.writeFile(path.join(output, "startup-errors.json"), JSON.stringify(errors, null, 2));
        await fs.writeFile(path.join(output, "startup-pending.json"), JSON.stringify([...pending], null, 2));
        await fs.writeFile(path.join(output, "startup.html"), await page.content());
        throw new Error(`Preview verification startup failed: ${errors.join("\n")}`, { cause: failure });
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
              id: "audio-preview",
              filename: "media-preview-audio.mkv",
              inputPath: "C:/media-preview-audio.mp4",
              outputPath: "/docs-screenshots/__local_tmp/media-preview-audio.mkv",
              type: "video",
            },
            {
              id: "image-preview",
              filename: "media-preview-image.tiff",
              inputPath: "C:/media-preview-image.mp4",
              outputPath: "/docs-screenshots/__local_tmp/media-preview-image.tiff",
              type: "video",
            },
            {
              id: "audio-without-cover",
              filename: "song-without-cover.mkv",
              inputPath: "/docs-screenshots/__local_tmp/media-preview-audio.mkv",
              outputPath: "/docs-screenshots/__local_tmp/media-preview-audio.mkv",
              type: "audio",
            },
          ].map((job) => ({
            ...job,
            source: "manual",
            originalSizeMB: 1,
            presetId: "p1",
            status: "completed",
            progress: 100,
            previewRevision: 0,
          })),
        }),
      );
      for (const locale of ["zh-CN", "en"]) {
        if (locale === "en") {
          await page.getByTestId("ffui-locale-trigger").click();
          await page.getByTestId("ffui-locale-en").click();
        }
        const audioCard = page.getByTestId("queue-item-card").filter({ hasText: "media-preview-audio.mkv" });
        await audioCard.getByTestId("queue-item-thumbnail").click();
        const dialog = page.getByTestId("expanded-preview-dialog");
        await dialog.waitFor();
        const audio = dialog.getByTestId("task-detail-expanded-audio");
        await audio.waitFor();
        await audio.evaluate((element) => element.dispatchEvent(new Event("error")));
        await dialog.getByTestId("media-preview-compatible").waitFor();
        assert.ok((await audio.getAttribute("src")).endsWith("audio-preview.m4a"));
        await page.waitForFunction(() => {
          const player = document.querySelector('[data-testid="task-detail-expanded-audio"]');
          return player && player.readyState >= 2;
        });
        assert.equal(await dialog.locator("video").count(), 0);
        assert.equal(await dialog.getByTestId("fallback-media-preview").count(), 0);
        assert.equal(await audio.getAttribute("controls"), "");
        await audio.evaluate(async (element) => {
          element.currentTime = 0;
          await element.play();
        });
        await page.waitForFunction(
          () => document.querySelector('[data-testid="task-detail-expanded-audio"]').currentTime > 0.2,
        );
        assert.ok(await audio.evaluate((element) => element.duration > 1.9 && element.duration < 2.1));
        await audio.evaluate((element) => {
          element.currentTime = 1;
        });
        await page.waitForFunction(
          () => document.querySelector('[data-testid="task-detail-expanded-audio"]').currentTime > 1.2,
        );
        assert.ok(
          (await dialog.getByTestId("expanded-preview-title-text").textContent()).includes("media-preview-audio.mkv"),
        );
        await dialog.screenshot({ path: path.join(output, `audio-preview-${locale}.png`) });
        await audio.evaluate((element) => {
          window.__FFUI_PREVIEW_PLAYER__ = element;
        });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => window.__FFUI_PREVIEW_PLAYER__.paused), true);

        const imageCard = page.getByTestId("queue-item-card").filter({ hasText: "media-preview-image.tiff" });
        await imageCard.getByTestId("queue-item-thumbnail").click();
        await dialog.waitFor();
        const image = dialog.getByTestId("task-detail-expanded-image");
        await image.waitFor();
        await page.waitForFunction(() => {
          const picture = document.querySelector('[data-testid="task-detail-expanded-image"]');
          return picture?.complete && picture.naturalWidth === 33 && picture.naturalHeight === 35;
        });
        assert.equal(await dialog.locator("video,audio").count(), 0);
        assert.equal(await dialog.getByTestId("fallback-media-preview").count(), 0);
        await dialog.screenshot({ path: path.join(output, `image-preview-${locale}.png`) });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
      await page.getByTestId("ffui-queue-view-mode-trigger").click();
      await page.getByTestId("ffui-queue-view-mode-icon-large").click();
      const noCoverCard = page.getByTestId("queue-icon-item").filter({ hasText: "song-without-cover.mkv" });
      await noCoverCard.getByTestId("queue-audio-placeholder").click();
      const noCoverDialog = page.getByTestId("expanded-preview-dialog");
      await noCoverDialog.getByTestId("task-detail-expanded-audio").waitFor();
      assert.equal(await noCoverDialog.locator("video").count(), 0);
      await noCoverDialog.screenshot({ path: path.join(output, "audio-without-cover-icon.png") });
      await page.keyboard.press("Escape");
      await noCoverDialog.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      await fs.writeFile(
        path.join(output, "verification.json"),
        JSON.stringify(
          {
            audioPlaybackAdvanced: true,
            compatibleAacPlaybackAndSeek: true,
            audioWithoutCoverIconEntry: true,
            selectedSourcePreserved: true,
            imageDimensions: [33, 35],
            videoFallbackAbsent: true,
            locales: ["zh-CN", "en"],
          },
          null,
          2,
        ),
      );
    };
    try {
      await verifyPage();
    } finally {
      await browser.close();
    }
  },
);
