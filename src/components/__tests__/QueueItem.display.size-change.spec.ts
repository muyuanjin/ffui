// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
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
    status: "processing",
    progress: 10,
    logs: [],
    mediaInfo: undefined,
    previewPath: "C:/app-data/previews/abc123.jpg",
    inputPath: "C:/videos/sample.mp4",
    outputPath: "C:/videos/sample.compressed.mp4",
    ffmpegCommand: 'ffmpeg -i "input" -c:v libx264 output.mp4',
    outputSizeMB: 5,
    failureReason: undefined,
    skipReason: undefined,
    logTail: "",
    ...overrides,
  };
}

describe("QueueItem display size change indicators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows green color for output size when file size decreased after transcoding", () => {
    const job = makeJob({
      originalSizeMB: 10,
      outputSizeMB: 5,
      status: "completed",
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

    const outputSizeSpan = wrapper.find("span.text-emerald-400.font-bold");
    expect(outputSizeSpan.exists()).toBe(true);
    expect(outputSizeSpan.text()).toContain("5.00 MB");
  });

  it("shows amber color for output size when file size slightly increased (<100%)", () => {
    const job = makeJob({
      originalSizeMB: 10,
      outputSizeMB: 15,
      status: "completed",
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

    const outputSizeSpan = wrapper.find("span.text-amber-400.font-bold");
    expect(outputSizeSpan.exists()).toBe(true);
    expect(outputSizeSpan.text()).toContain("15.00 MB");
    expect(wrapper.find("span.text-emerald-400.font-bold").exists()).toBe(false);
    expect(wrapper.find("span.text-red-400.font-bold").exists()).toBe(false);
  });

  it("shows red color for output size when file size doubled or more (≥100%)", () => {
    const job = makeJob({
      originalSizeMB: 10,
      outputSizeMB: 20,
      status: "completed",
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

    const outputSizeSpan = wrapper.find("span.text-red-400.font-bold");
    expect(outputSizeSpan.exists()).toBe(true);
    expect(outputSizeSpan.text()).toContain("20.00 MB");
    expect(wrapper.find("span.text-emerald-400.font-bold").exists()).toBe(false);
    expect(wrapper.find("span.text-amber-400.font-bold").exists()).toBe(false);
  });
});
