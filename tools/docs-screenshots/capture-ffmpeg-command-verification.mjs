import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { withViteDevServer } from "./lib/viteDevServer.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, ".cache/ffmpeg-command-ux/screenshots"));
const contract = JSON.parse(
  await fs.readFile(path.join(repoRoot, "src-tauri/tests/ffmpeg-command-input-contract.json"), "utf8"),
);
await fs.mkdir(outDir, { recursive: true });

await withViteDevServer(
  {
    repoRoot,
    viteBin: path.join(repoRoot, "node_modules/vite/bin/vite.js"),
    configPath: path.join(repoRoot, "tools/docs-screenshots/vite.config.screenshots.ts"),
    env: { VITE_STARTUP_IDLE_TIMEOUT_MS: "0", VITE_DOCS_SCREENSHOT_HAS_TAURI: "1" },
  },
  async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
      page.setDefaultTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(`${baseUrl}?ffuiLocale=zh-CN`, { waitUntil: "commit", timeout: 90_000 });
      await page.getByTestId("ffui-sidebar").waitFor({ timeout: 90_000 });
      const actions = page.getByTestId("ffui-sidebar-add-actions");
      const entry = page.getByTestId("add-ffmpeg-command");
      assert.equal(await entry.count(), 1);
      assert.equal(await actions.getByTestId("add-ffmpeg-command").count(), 1);
      const entryBox = await entry.boundingBox();
      const compressionBox = await actions.getByTestId("ffui-action-batch-compress").boundingBox();
      assert.ok(entryBox && compressionBox && entryBox.y >= compressionBox.y + compressionBox.height);
      await page.screenshot({ path: path.join(outDir, "sidebar-zh-CN.png") });

      for (const locale of ["zh-CN", "en"]) {
        if (locale === "en") {
          await page.getByTestId("ffui-locale-trigger").click();
          await page.getByTestId("ffui-locale-en").click();
          await page.waitForFunction(() =>
            document.querySelector('[data-testid="add-ffmpeg-command"]')?.textContent?.includes("Add FFmpeg command"),
          );
        }
        assert.equal((await entry.textContent()).trim(), locale === "en" ? "Add FFmpeg command" : "添加 FFmpeg 命令");
        await entry.click();
        const dialog = page.getByTestId("ffmpeg-command-dialog");
        await dialog.waitFor();
        const advanced = page.getByTestId("ffmpeg-command-advanced");
        assert.equal(await advanced.getAttribute("open"), null);
        assert.equal(await page.getByTestId("ffmpeg-command-name").isVisible(), false);
        assert.equal(await page.getByTestId("ffmpeg-command-submit").isDisabled(), true);
        await dialog.screenshot({ path: path.join(outDir, `command-empty-${locale}.png`) });

        const commandCase = contract.valid.find((entry) => entry.id === "windows-unicode");
        await page.getByTestId("ffmpeg-command-input").fill(commandCase.command);
        await page.getByTestId("ffmpeg-command-preview").waitFor();
        assert.equal(await page.getByTestId("ffmpeg-command-preview").locator("li").count(), commandCase.args.length);
        assert.ok(
          (await page.getByTestId("ffmpeg-command-preview").textContent()).includes("C:\\音乐 文件\\track.wav"),
        );
        assert.equal(await page.getByTestId("ffmpeg-command-submit").isEnabled(), true);
        await dialog.screenshot({ path: path.join(outDir, `command-preview-${locale}.png`) });

        await advanced.locator("summary").click();
        assert.equal(await page.getByTestId("ffmpeg-command-name").isVisible(), true);
        assert.equal(
          await page.getByTestId("ffmpeg-command-name").getAttribute("placeholder"),
          locale === "en" ? "Custom FFmpeg task" : "自定义 FFmpeg 任务",
        );
        await dialog.screenshot({ path: path.join(outDir, `command-advanced-${locale}.png`) });

        await page
          .getByTestId("ffmpeg-command-input")
          .fill(contract.invalid.find((entry) => entry.id === "unclosed").command);
        await dialog.getByRole("alert").waitFor();
        assert.equal(await page.getByTestId("ffmpeg-command-submit").isDisabled(), true);
        await dialog.screenshot({ path: path.join(outDir, `command-error-${locale}.png`) });
        await page.getByTestId("ffmpeg-command-input").fill(contract.valid[0].command);
        await page.getByTestId("ffmpeg-command-preview").waitFor();
        await page.getByTestId("ffmpeg-command-submit").click();
        await dialog.waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
      await fs.writeFile(
        path.join(outDir, "verification.json"),
        JSON.stringify(
          {
            mode: "mock UI; no real FFmpeg execution",
            locales: ["zh-CN", "en"],
            checks: [
              "single sidebar entry below creation actions",
              "collapsed optional settings",
              "command preview",
              "diagnostic blocks enqueue",
              "default name",
              "runtime locale switch",
              "enqueue closes dialog",
              "no page errors",
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
