import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import QueueItem from "@/components/QueueItem.vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
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

describe("QueueItem", () => {
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
    // Should show input and output sizes and not produce NaN.
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
    // Should still render input size and not show NaN.
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
    // Queue rows should only surface the compact ffmpeg command summary, not the full logs.
    expect(content).toContain("ffmpeg -i");
    expect(content).not.toContain("ffmpeg exited with non-zero status");
  });

  it("emits inspect event with the job payload when card is clicked", () => {
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

    wrapper.trigger("click");
    const emitted = wrapper.emitted("inspect");
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toEqual(job);
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
    const job = makeJob({
      previewPath: "C:/app-data/previews/abc123.jpg",
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

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.element).toBeTruthy();
    expect(img.attributes("src")).toBe(job.previewPath);
  });

  it("renders a stable thumbnail placeholder when previewPath is missing", () => {
    const job = makeJob({
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

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    expect(thumb.element).toBeTruthy();
    const imgs = thumb.findAll("img");
    // When there is no previewPath, we render a stable placeholder container
    // without an <img> element.
    expect(imgs.length).toBe(0);
  });
});
