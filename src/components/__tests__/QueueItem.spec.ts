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

  it("renders full logs block with command and error lines for failed jobs", () => {
    const job = makeJob({
      status: "failed",
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
    expect(content).toContain("command: ffmpeg");
    expect(content).toContain("ffmpeg exited with non-zero status");
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
});
