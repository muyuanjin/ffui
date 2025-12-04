import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { FFmpegPreset, JobStatus, TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(
    async (path: string) => `data:image/jpeg;base64,TEST:${path}`,
  );

  return {
    buildPreviewUrl: (path: string | null) => path,
    hasTauri,
    loadPreviewDataUrl,
  };
});

import { hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import QueueItem from "@/components/QueueItem.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
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

describe("QueueItem", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    (loadPreviewDataUrl as any).mockReset();
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
    // Compact view still surfaces basic identifiers but hides heavy detail sections.
    expect(text).toContain("10.00 MB");
    expect(text.toLowerCase()).toContain("sample.mp4");
    // ffmpeg command snippet should be hidden in compact view.
    expect(wrapper.find("pre").exists()).toBe(false);
  });

  it("renders localized status text and visual style for common job statuses", () => {
    const statuses: JobStatus[] = [
      "processing",
      "completed",
      "paused",
      "waiting",
      "failed",
      "skipped",
      "cancelled",
    ];

    const expectedClassByStatus: Record<JobStatus, string> = {
      completed: "text-emerald-500",
      processing: "text-blue-500",
      paused: "text-amber-500",
      waiting: "text-amber-500",
      failed: "text-red-500",
      skipped: "text-muted-foreground",
      cancelled: "text-muted-foreground",
      queued: "text-muted-foreground",
    };

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
    const job = makeJob({
      filename: longPath,
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

    const heading = wrapper.get("h4");
    expect(heading.attributes("title")).toBe(longPath);
    expect(heading.text()).toBe(
      "ultra-long-file-name-with-details.mp4",
    );
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

  it("falls back to backend data URL when thumbnail fails to load in Tauri mode", async () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/abc123.jpg",
    });

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
    // Simulate the <img> error handler being triggered when asset:// preview fails.
    await vm.handlePreviewError();
    await nextTick();

    expect(loadPreviewDataUrl).toHaveBeenCalledTimes(1);
    expect(loadPreviewDataUrl).toHaveBeenCalledWith(job.previewPath);

    const thumb = wrapper.get("[data-testid='queue-item-thumbnail']");
    const img = thumb.find("img");
    expect(img.attributes("src")).toBe("data:image/jpeg;base64,FALLBACK=");
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

  it("uses bar progress style when progressStyle is bar", () => {
    const job = makeJob({
      status: "processing",
      progress: 42,
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
        progressStyle: "bar",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.find("[data-testid='queue-item-progress-bar']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='queue-item-progress-card-fill']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='queue-item-progress-ripple-card']").exists()).toBe(false);
  });

  it("uses distinct card-fill and ripple-card progress styles", () => {
    const baseJob = makeJob({
      status: "processing",
      progress: 50,
    });

    const cardFillWrapper = mount(QueueItem, {
      props: {
        job: baseJob,
        preset: basePreset,
        canCancel: false,
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const rippleWrapper = mount(QueueItem, {
      props: {
        job: baseJob,
        preset: basePreset,
        canCancel: false,
        progressStyle: "ripple-card",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(
      cardFillWrapper.find("[data-testid='queue-item-progress-card-fill']").exists(),
    ).toBe(true);
    expect(
      cardFillWrapper.find("[data-testid='queue-item-progress-ripple-card']").exists(),
    ).toBe(false);

    expect(
      rippleWrapper.find("[data-testid='queue-item-progress-ripple-card']").exists(),
    ).toBe(true);
    expect(
      rippleWrapper.find("[data-testid='queue-item-progress-card-fill']").exists(),
    ).toBe(false);
  });

  it("maps progress percentage to card-level fill width for card-fill and ripple-card styles", () => {
    const job = makeJob({
      status: "processing",
      progress: 42,
    });

    const cardFillWrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const cardFillContainer = cardFillWrapper.get(
      "[data-testid='queue-item-progress-card-fill']",
    );
    const cardFillDivs = cardFillContainer.findAll("div");
    const cardFillInner = cardFillDivs.find(
      (el) => (el.element as HTMLDivElement).style.width !== "",
    );
    expect(cardFillInner).toBeTruthy();
    expect((cardFillInner!.element as HTMLDivElement).style.width).toBe("42%");

    const rippleWrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: false,
        progressStyle: "ripple-card",
      },
      global: {
        plugins: [i18n],
      },
    });

    const rippleContainer = rippleWrapper.get(
      "[data-testid='queue-item-progress-ripple-card']",
    );
    const rippleDivs = rippleContainer.findAll("div");
    const rippleFill = rippleDivs.find(
      (el) => (el.element as HTMLDivElement).style.width !== "",
    );
    expect(rippleFill).toBeTruthy();
    expect((rippleFill!.element as HTMLDivElement).style.width).toBe("42%");
  });

  it("clamps progress to the [0, 100] range before mapping to visual fill", () => {
    const belowZeroJob = makeJob({
      status: "processing",
      progress: -25,
    });

    const belowWrapper = mount(QueueItem, {
      props: {
        job: belowZeroJob,
        preset: basePreset,
        canCancel: false,
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const belowContainer = belowWrapper.get(
      "[data-testid='queue-item-progress-card-fill']",
    );
    const belowDivs = belowContainer.findAll("div");
    const belowInner = belowDivs.find(
      (el) => (el.element as HTMLDivElement).style.width !== "",
    );
    expect(belowInner).toBeTruthy();
    expect((belowInner!.element as HTMLDivElement).style.width).toBe("0%");

    const aboveHundredJob = makeJob({
      status: "processing",
      progress: 250,
    });

    const aboveWrapper = mount(QueueItem, {
      props: {
        job: aboveHundredJob,
        preset: basePreset,
        canCancel: false,
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const aboveContainer = aboveWrapper.get(
      "[data-testid='queue-item-progress-card-fill']",
    );
    const aboveDivs = aboveContainer.findAll("div");
    const aboveInner = aboveDivs.find(
      (el) => (el.element as HTMLDivElement).style.width !== "",
    );
    expect(aboveInner).toBeTruthy();
    expect((aboveInner!.element as HTMLDivElement).style.width).toBe("100%");
  });
});
