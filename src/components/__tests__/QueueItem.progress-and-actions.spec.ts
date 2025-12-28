// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`);

  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    hasTauri,
    loadPreviewDataUrl,
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
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

describe("QueueItem progress and actions", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    (loadPreviewDataUrl as any).mockReset();
  });

  it("uses bar progress style when progressStyle is bar", () => {
    const job = makeJob({ status: "processing", progress: 42 });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: false, progressStyle: "bar" },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("[data-testid='queue-item-progress-bar']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='queue-item-progress-card-fill']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='queue-item-progress-ripple-card']").exists()).toBe(false);
  });

  it("uses distinct card-fill and ripple-card progress styles", () => {
    const baseJob = makeJob({ status: "processing", progress: 50 });

    const cardFillWrapper = mount(QueueItem, {
      props: { job: baseJob, preset: basePreset, canCancel: false, progressStyle: "card-fill" },
      global: { plugins: [i18n] },
    });

    const rippleWrapper = mount(QueueItem, {
      props: { job: baseJob, preset: basePreset, canCancel: false, progressStyle: "ripple-card" },
      global: { plugins: [i18n] },
    });

    expect(cardFillWrapper.find("[data-testid='queue-item-progress-card-fill']").exists()).toBe(true);
    expect(cardFillWrapper.find("[data-testid='queue-item-progress-ripple-card']").exists()).toBe(false);

    expect(rippleWrapper.find("[data-testid='queue-item-progress-ripple-card']").exists()).toBe(true);
    expect(rippleWrapper.find("[data-testid='queue-item-progress-card-fill']").exists()).toBe(false);
  });

  it("maps progress percentage to card-level fill width for card-fill and ripple-card styles", () => {
    const job = makeJob({ status: "processing", progress: 42 });

    const cardFillWrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: false, progressStyle: "card-fill" },
      global: { plugins: [i18n] },
    });

    const rippleWrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: false, progressStyle: "ripple-card" },
      global: { plugins: [i18n] },
    });

    const cardFill = cardFillWrapper.get("[data-testid='queue-item-progress-fill']");
    const rippleFill = rippleWrapper.get("[data-testid='queue-item-progress-fill']");

    expect((cardFill.element as HTMLElement).style.clipPath).toContain("inset(0 58% 0 0)");
    expect((rippleFill.element as HTMLElement).style.transform).toContain("translateX(-58%)");
  });

  it("clamps progress to the [0, 100] range before mapping to visual fill", () => {
    const job = makeJob({ status: "processing", progress: 180 });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: false, progressStyle: "card-fill" },
      global: { plugins: [i18n] },
    });

    const fill = wrapper.get("[data-testid='queue-item-progress-fill']");
    expect((fill.element as HTMLElement).style.clipPath).toContain("inset(0 0% 0 0)");
  });

  it("treats cancelled jobs as fully progressed for visual card fill (aligns with header aggregate progress)", async () => {
    const job = makeJob({ status: "processing", progress: 60, previewPath: "path.jpg" });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: false, progressStyle: "card-fill" },
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    wrapper.setProps({ job: { ...job, status: "cancelled", progress: 60 } });
    await nextTick();

    const fill = wrapper.get("[data-testid='queue-item-progress-fill']");
    expect((fill.element as HTMLElement).style.clipPath).toContain("inset(0 0% 0 0)");

    vm.handlePreviewError = vi.fn();
    await vm.handlePreviewError();
    expect(vm.handlePreviewError).toHaveBeenCalled();
  });

  it("shows wait/resume/restart buttons based on status and emits corresponding events", async () => {
    const job = makeJob({ status: "processing", progress: 50 });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canCancel: true, canWait: true, canResume: true, canRestart: true },
      global: { plugins: [i18n] },
    });

    const waitButton = wrapper.get("[data-testid='queue-item-wait-button']");
    await waitButton.trigger("click");
    expect(wrapper.emitted("wait")?.[0]).toEqual([job.id]);

    await wrapper.setProps({ job: { ...job, status: "paused" } });
    const resumeButton = wrapper.get("[data-testid='queue-item-resume-button']");
    await resumeButton.trigger("click");
    expect(wrapper.emitted("resume")?.[0]).toEqual([job.id]);

    await wrapper.setProps({ job: { ...job, status: "failed" } });
    const restartButton = wrapper.get("[data-testid='queue-item-restart-button']");
    await restartButton.trigger("click");
    expect(wrapper.emitted("restart")?.[0]).toEqual([job.id]);
  });

  it("shows a pausing indicator and disables the wait button when waitRequestPending is true", () => {
    const job = makeJob({ status: "processing", progress: 50, waitRequestPending: true });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
        canWait: true,
        canResume: true,
        canRestart: true,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("[data-testid='queue-item-wait-button']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='queue-item-status-label']").text()).toBe("pausing…");
    const button = wrapper.get("[data-testid='queue-item-pausing-button']");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("renders a selection toggle when canSelect is true and emits toggle-select with job id", async () => {
    const job = makeJob({ status: "completed" });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canSelect: true, selected: false },
      global: { plugins: [i18n] },
    });

    const checkbox = wrapper.get("[data-testid='queue-item-select-toggle']");
    await checkbox.trigger("click");
    expect(wrapper.emitted("toggle-select")?.[0]).toEqual([job.id]);
  });

  it("applies a highlighted card style when the row is selected", () => {
    const job = makeJob({ status: "completed" });

    const wrapper = mount(QueueItem, {
      props: { job, preset: basePreset, canSelect: true, selected: true },
      global: { plugins: [i18n] },
    });

    const root = wrapper.element as HTMLElement;
    expect(root.className).toContain("border-primary/80");
    expect(root.className).toContain("ring-inset");
    expect(root.className).toMatch(/\b(!ring-2|ring-2)\b/);
  });
});
