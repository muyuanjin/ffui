// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(
    async (path: string) => `data:image/jpeg;base64,TEST:${path}`,
  );

  return {
    buildPreviewUrl: (path: string | null) => path,
    hasTauri,
    loadPreviewDataUrl,
    selectPlayableMediaPath: vi.fn(
      async (candidates: string[]) => candidates[0] ?? null,
    ),
  };
});

vi.mock("@/lib/ffmpegCommand", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ffmpegCommand")>(
    "@/lib/ffmpegCommand",
  );
  return {
    ...actual,
    highlightFfmpegCommand: (command: string) => command,
    normalizeFfmpegTemplate: (command: string) => ({
      template: command ? `TEMPLATE:${command}` : "",
    }),
  };
});

import { hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import QueueItem from "@/components/QueueItem.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueueItem tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

function makeJob(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/sample.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: basePreset.id,
    status: "completed",
    progress: 100,
    startTime: Date.now(),
    endTime: Date.now(),
    outputSizeMB: 5,
    logs: [],
    skipReason: undefined,
    ...overrides,
  };
}

describe("QueueItem display basics", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    (loadPreviewDataUrl as any).mockReset();
    (i18n.global.locale as any).value = "en";
  });

  it("renders job sizes and savings without throwing", () => {
    const job = makeJob();

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("10.00 MB");
    expect(text).toContain("5.00 MB");
    expect(text.toLowerCase()).not.toContain("nan");
  });

  it("handles missing outputSizeMB gracefully", () => {
    const job = makeJob({ outputSizeMB: undefined });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("10.00 MB");
    expect(text.toLowerCase()).not.toContain("nan");
  });

  it("renders only the ffmpeg command snippet instead of full logs for failed jobs", () => {
    const job = makeJob({
      status: "failed",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 -preset medium -c:a copy "C:/videos/sample.compressed.mp4"',
      logs: [
        "command: ffmpeg -i \"C:/videos/sample.mp4\" -c:v libx264 -crf 23 -preset medium -c:a copy \"C:/videos/sample.compressed.mp4\"",
        "ffmpeg exited with non-zero status (exit code -22)",
      ],
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const pre = wrapper.find("pre");
    expect(pre.exists()).toBe(true);
    const content = pre.text();
    expect(content).toContain("ffmpeg -i");
    expect(content).not.toContain("ffmpeg exited with non-zero status");
  });

  it("toggles selection instead of opening details when card is clicked in selectable mode", async () => {
    const job = makeJob();

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
        canSelect: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.trigger("click");

    const selectEvents = wrapper.emitted("toggle-select");
    const inspectEvents = wrapper.emitted("inspect");

    expect(selectEvents).toBeTruthy();
    expect(selectEvents?.[0]?.[0]).toBe(job.id);
    expect(inspectEvents).toBeFalsy();
  });

  it("emits inspect when card is clicked in non-selectable contexts (e.g. compact job lists)", async () => {
    const job = makeJob();

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
        // canSelect omitted => non-selectable
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.trigger("click");

    const inspectEvents = wrapper.emitted("inspect");
    const selectEvents = wrapper.emitted("toggle-select");

    expect(inspectEvents).toBeTruthy();
    expect(inspectEvents?.[0]?.[0]).toEqual(job);
    expect(selectEvents).toBeFalsy();
  });

  it("uses the dedicated detail button to open task details without changing selection", async () => {
    const job = makeJob();

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
        canSelect: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const detailButton = wrapper.get("[data-testid='queue-item-detail-button']");
    await detailButton.trigger("click");

    const inspectEvents = wrapper.emitted("inspect");
    const selectEvents = wrapper.emitted("toggle-select");

    expect(inspectEvents).toBeTruthy();
    expect(inspectEvents?.[0]?.[0]).toEqual(job);
    expect(selectEvents).toBeFalsy();
  });

  it("emits preview only (no inspect) when thumbnail is clicked", async () => {
    const job = makeJob({ previewPath: "C:/app-data/previews/abc123.jpg" });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    await thumb.trigger("click");

    const previewEvents = wrapper.emitted("preview");
    const inspectEvents = wrapper.emitted("inspect");

    expect(previewEvents).toBeTruthy();
    expect(previewEvents?.[0]?.[0]).toEqual(job);
    expect(inspectEvents).toBeFalsy();
  });

  it("renders a more compact row when viewMode is compact", () => {
    const job = makeJob({
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 -preset medium -c:a copy "C:/videos/sample.compressed.mp4"',
      mediaInfo: {
        durationSeconds: 125,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: "h264",
        sizeMB: 10,
      },
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
        viewMode: "compact",
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("10.00 MB");
    expect(text.toLowerCase()).toContain("sample.mp4");
    expect(wrapper.find("pre").exists()).toBe(false);
  });

  it("renders localized status text and visual style for common job statuses", () => {
    const statuses = [
      "processing",
      "completed",
      "paused",
      "waiting",
      "failed",
      "skipped",
      "cancelled",
    ] as const;

    const expectedClassByStatus = {
      completed: "text-emerald-500",
      processing: "text-blue-500",
      paused: "text-amber-500",
      waiting: "text-amber-500",
      failed: "text-red-500",
      skipped: "text-muted-foreground",
      cancelled: "text-muted-foreground",
      queued: "text-muted-foreground",
    } as const;

    for (const status of statuses) {
      const job = makeJob({
        status,
        progress: status === "waiting" || status === "skipped" ? 0 : 42,
      });

      const wrapper = mount(QueueItem, {
        props: {
          job,
          preset: basePreset,
          canCancel: true,
        },
        global: {
          plugins: [i18n],
        },
      });

      const statusEl = wrapper.get("span.text-xs.font-bold");
      const expectedText = (en as any).queue.status[status];

      expect(statusEl.text()).toBe(expectedText);
      expect(statusEl.classes()).toContain(expectedClassByStatus[status]);
    }
  });

  it("truncates long filenames while keeping the full path in the title attribute", () => {
    const longPath =
      "C:/a/very/long/path/with/many/segments/and spaces/ultra-long-file-name-with-details.mp4";
    const job = makeJob({ filename: longPath });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const heading = wrapper.get("h4");
    expect(heading.attributes("title")).toBe(longPath);
    expect(heading.text()).toBe("ultra-long-file-name-with-details.mp4");
  });

  it("renders media summary when mediaInfo is present", () => {
    const job = makeJob({
      mediaInfo: {
        durationSeconds: 125,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: "h264",
        sizeMB: 10,
      },
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("1920×1080");
    expect(text.toLowerCase()).toContain("h264");
  });

  it("renders a thumbnail image when previewPath is present (pure web mode)", () => {
    const job = makeJob({ previewPath: "C:/app-data/previews/abc123.jpg" });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.element).toBeTruthy();
    expect(img.attributes("src")).toBe(job.previewPath);
  });

  it("falls back to backend data URL when thumbnail fails to load in Tauri mode", async () => {
    const job = makeJob({ previewPath: "C:/app-data/previews/abc123.jpg" });

    (hasTauri as any).mockReturnValue(true);
    (loadPreviewDataUrl as any).mockResolvedValueOnce("data:image/jpeg;base64,FALLBACK=");

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    await vm.handlePreviewError();

    expect(loadPreviewDataUrl).toHaveBeenCalledTimes(1);
    expect(loadPreviewDataUrl).toHaveBeenCalledWith(job.previewPath);

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.attributes("src")).toBe("data:image/jpeg;base64,FALLBACK=");
  });

  it("renders a stable thumbnail placeholder when previewPath is missing", () => {
    const job = makeJob({ previewPath: undefined });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const imgs = thumb.findAll("img");
    expect(imgs.length).toBe(0);
  });

  it("uses i18n labels for the command view toggle and updates on locale change", async () => {
    const job = makeJob({
      status: "completed",
      ffmpegCommand:
        'ffmpeg -i "INPUT" -c:v libx264 -crf 23 -preset medium -c:a copy "OUTPUT"',
    });

    // Start in zh-CN so we can assert Chinese labels first.
    (i18n.global.locale as any).value = "zh-CN";

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    // Toggle button should exist and use the zh-CN label.
    const toggleButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("显示完整命令"));

    expect(toggleButton, "command view toggle button should exist").toBeTruthy();

    // Switch locale to EN at runtime.
    (i18n.global.locale as any).value = "en";
    await nextTick();

    const enToggleButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("Show full command"));

    expect(enToggleButton, "command view toggle should reflect EN label").toBeTruthy();
  });

  it("toggles between template and full command using the raw ffmpegCommand string", async () => {
    const rawCommand =
      '"C:/Program Files/FFmpeg/bin/ffmpeg.exe" -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"';
    const job = makeJob({
      status: "completed",
      ffmpegCommand: rawCommand,
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    // 初始为模板视图：mock 的 normalizeFfmpegTemplate 会在前面加上 "TEMPLATE:"
    let pre = wrapper.get("pre");
    expect(pre.text()).toBe(`TEMPLATE:${rawCommand}`);

    const toggleButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("Show full command"));

    expect(toggleButton, "command view toggle button should exist").toBeTruthy();

    await toggleButton!.trigger("click");
    await nextTick();

    // 切换到“完整命令”视图后，应直接展示原始 ffmpegCommand 字符串
    pre = wrapper.get("pre");
    expect(pre.text()).toBe(rawCommand);
  });
});
