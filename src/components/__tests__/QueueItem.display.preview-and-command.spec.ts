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
  const loadPreviewDataUrl = vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`);
  const ensureJobPreview = vi.fn(async () => null);

  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    hasTauri,
    loadPreviewDataUrl,
    ensureJobPreview,
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

vi.mock("@/lib/ffmpegCommand", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ffmpegCommand")>("@/lib/ffmpegCommand");
  return {
    ...actual,
    highlightFfmpegCommand: (command: string) => command,
    normalizeFfmpegTemplate: (command: string) => ({
      template: command ? `TEMPLATE:${command}` : "",
    }),
  };
});

import { ensureJobPreview, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import QueueItem from "@/components/QueueItem.vue";
import { copyToClipboard } from "@/lib/copyToClipboard";

vi.mock("@/lib/copyToClipboard", () => ({
  copyToClipboard: vi.fn(async () => {}),
}));

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

describe("QueueItem display preview & command view", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    (loadPreviewDataUrl as any).mockReset();
    i18n.global.locale.value = "en";
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

  it("cache-busts the thumbnail src when previewRevision changes but previewPath stays stable (Tauri mode)", async () => {
    const job = makeJob({ previewPath: "C:/app-data/previews/abc123.jpg", previewRevision: 1 });

    (hasTauri as any).mockReturnValue(true);

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
    expect(img.attributes("src")).toBe("C:/app-data/previews/abc123.jpg?ffuiPreviewRev=1");

    await wrapper.setProps({
      job: { ...job, previewRevision: 2 },
    });
    await nextTick();

    const img2 = wrapper.get("[data-testid='queue-item-thumbnail']").find("img");
    expect(img2.attributes("src")).toBe("C:/app-data/previews/abc123.jpg?ffuiPreviewRev=2");
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

  it("regenerates preview when thumbnail is missing in Tauri mode", async () => {
    const job = makeJob({ previewPath: "C:/app-data/previews/abc123.jpg" });

    (hasTauri as any).mockReturnValue(true);
    (loadPreviewDataUrl as any).mockRejectedValueOnce(new Error("preview missing"));
    (ensureJobPreview as any).mockResolvedValueOnce("C:/app-data/previews/regenerated.jpg");

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
    expect(ensureJobPreview).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledWith(job.id);

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.attributes("src")).toBe("C:/app-data/previews/regenerated.jpg");
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

  it("falls back to input/output path for image jobs when previewPath is missing", async () => {
    const job = makeJob({
      type: "image",
      filename: "C:/images/sample.avif",
      inputPath: "C:/images/sample.avif",
      outputPath: undefined,
      previewPath: undefined,
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

    await nextTick();

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.exists()).toBe(true);
    // 在测试环境中 buildPreviewUrl 会直接返回原始路径，因此应等于 inputPath。
    expect(img.attributes("src")).toBe(job.inputPath);
  });

  it("uses i18n labels for the command view toggle and updates on locale change", async () => {
    const job = makeJob({
      status: "completed",
      ffmpegCommand: 'ffmpeg -i "INPUT" -c:v libx264 -crf 23 -preset medium -c:a copy "OUTPUT"',
    });

    i18n.global.locale.value = "zh-CN";

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

    const toggleButton = wrapper.findAll("button").find((btn) => btn.text().includes("显示完整命令"));

    expect(toggleButton, "command view toggle button should exist").toBeTruthy();

    i18n.global.locale.value = "en";
    await nextTick();

    const enToggleButton = wrapper.findAll("button").find((btn) => btn.text().includes("Show full command"));

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

    let pre = wrapper.get("pre");
    expect(pre.text()).toBe(`TEMPLATE:${rawCommand}`);

    const toggleButton = wrapper.findAll("button").find((btn) => btn.text().includes("Show full command"));

    expect(toggleButton, "command view toggle button should exist").toBeTruthy();

    await toggleButton!.trigger("click");
    await nextTick();

    pre = wrapper.get("pre");
    expect(pre.text()).toBe(rawCommand);
  });

  it("exposes a copy button for the currently displayed command", async () => {
    const rawCommand = 'ffmpeg -i "INPUT" -c:v libx264 -crf 23 "OUTPUT"';
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

    const copyButton = wrapper.get("[data-testid='queue-item-copy-command']");
    await copyButton.trigger("click");

    // 默认处于 template 视图，因此应复制 TEMPLATE:... 版本。
    expect(copyToClipboard).toHaveBeenCalledWith(`TEMPLATE:${rawCommand}`);

    // 切换到 full view 后应复制 raw command。
    const toggleButton = wrapper.findAll("button").find((btn) => btn.text().includes("Show full command"));
    expect(toggleButton).toBeTruthy();

    await toggleButton!.trigger("click");
    await nextTick();

    await copyButton.trigger("click");
    expect(copyToClipboard).toHaveBeenCalledWith(rawCommand);
  });

  it("copies the resolved ffmpeg path when full command view is active", async () => {
    const rawCommand = 'ffmpeg -i "INPUT" -c:v libx264 -crf 23 "OUTPUT"';
    const resolvedPath = "C:/Program Files/FFmpeg/bin/ffmpeg.exe";
    const job = makeJob({
      status: "completed",
      ffmpegCommand: rawCommand,
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
        ffmpegResolvedPath: resolvedPath,
      },
      global: {
        plugins: [i18n],
      },
    });

    const copyButton = wrapper.get("[data-testid='queue-item-copy-command']");

    // Default is template view.
    await copyButton.trigger("click");
    expect(copyToClipboard).toHaveBeenCalledWith(`TEMPLATE:${rawCommand}`);

    const toggleButton = wrapper.findAll("button").find((btn) => btn.text().includes("Show full command"));
    expect(toggleButton).toBeTruthy();
    await toggleButton!.trigger("click");
    await nextTick();

    await copyButton.trigger("click");
    expect(copyToClipboard).toHaveBeenLastCalledWith(`"${resolvedPath}" -i "INPUT" -c:v libx264 -crf 23 "OUTPUT"`);
  });
});
