// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import type { WireTranscodeJob } from "@/lib/backend/generated/queue-contracts";
import { transcodeJobFromWire } from "@/lib/backend/queueContract";
import { hasIndeterminateQueueProgress } from "@/lib/queueExecutionCapabilities";
import contract from "../../../src-tauri/tests/audio-queue-contract.json";
import QueueItem from "@/components/QueueItem.vue";
import QueueIconItem from "@/components/QueueIconItem.vue";
import QueueCarousel3DCardContent from "@/components/queue-item/QueueCarousel3DCardContent.vue";
import QueueItemProgressLayer from "@/components/queue-item/QueueItemProgressLayer.vue";
import { Progress } from "@/components/ui/progress";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

vi.mock("@/lib/backend", () => ({ hasTauri: () => false, buildJobPreviewUrl: (path: string) => path }));

const preset: FFmpegPreset = {
  id: "audio",
  name: "AAC",
  description: "",
  video: { encoder: "copy", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "aac" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
};

const makeJob = () =>
  transcodeJobFromWire({
    id: "audio",
    filename: "C:\\音楽\\source.mp3",
    type: "audio",
    source: "manual",
    status: "processing",
    progress: 42,
    originalSizeMB: 1,
    presetId: "audio",
    execution: contract.execution,
    mediaInfo: contract.mediaInfo,
    waitMetadata: { lastProgressPercent: 42, progressEpoch: 1 },
  } as unknown as WireTranscodeJob);

describe("audio queue presentation and wire contract", () => {
  it.each(["detail", "compact", "mini"] as const)("retains publication progress limits in %s", async (viewMode) => {
    const job = {
      ...makeJob(),
      progress: 99.9,
      waitMetadata: {
        lastProgressPercent: 99.9,
        lastProgressOutTimeSeconds: 120,
        lastProgressUpdatedAtMs: Date.now(),
        lastProgressSpeed: 1,
      },
    };
    const global = { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })] };
    for (const progressStyle of ["bar", "card-fill", "ripple-card"] as const) {
      const wrapper = mount(QueueItem, { props: { job, preset, viewMode, progressStyle }, global });
      const progress = wrapper.findComponent(Progress);
      if (progress.exists()) expect(progress.props("modelValue")).toBe(99.9);
      const layer = wrapper.findComponent(QueueItemProgressLayer);
      if (viewMode !== "mini") expect(layer.props("displayedClampedProgress")).toBe(99.9);
      await wrapper.setProps({ job: { ...job, status: "completed", progress: 100 } });
      if (progress.exists()) expect(progress.props("modelValue")).toBe(100);
      if (viewMode !== "mini") expect(layer.props("displayedClampedProgress")).toBe(100);
      wrapper.unmount();
    }
    const carousel = mount(QueueCarousel3DCardContent, {
      props: { item: { kind: "job", job }, previewUrl: null, displayFilename: job.filename, selected: false },
      global,
    });
    expect(carousel.findComponent(Progress).props("modelValue")).toBe(99.9);
    expect(carousel.text()).toContain("99%");
    expect(carousel.text()).not.toContain("100%");
    await carousel.setProps({ item: { kind: "job", job: { ...job, status: "completed", progress: 100 } } });
    expect(carousel.findComponent(Progress).props("modelValue")).toBe(100);
    carousel.unmount();
  });
  it.each(["detail", "compact", "mini"] as const)("shows audio metadata and square fallback in %s", (viewMode) => {
    const job = makeJob();
    const i18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
    const wrapper = mount(QueueItem, {
      props: { job, preset, viewMode, progressStyle: "bar" },
      global: { plugins: [i18n] },
    });
    expect(wrapper.get('[data-testid="queue-audio-placeholder"]').attributes("aria-label")).toBe(
      en.queue.media.noAudioCover,
    );
    expect(wrapper.get('[data-testid="queue-item-thumbnail"]').classes()).toContain(
      viewMode === "mini" ? "w-8" : "w-[72px]",
    );
    const info = wrapper.get('[data-testid="queue-audio-info"]');
    for (const value of ["MP3", "2:00", "44.1 kHz", "2 channels", "192 kb/s"]) expect(info.text()).toContain(value);
    if (viewMode !== "mini") expect(info.text()).toContain("音楽 · 歌手 · Album");
    expect(wrapper.find('[data-testid="queue-item-progress-indeterminate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="queue-item-progress-bar"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("loads audio cover art and updates metadata immediately on locale switch", async () => {
    const job = { ...makeJob(), previewPath: "/cover.jpg" };
    const i18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
    const wrapper = mount(QueueItem, { props: { job, preset }, global: { plugins: [i18n] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="queue-item-thumbnail"] img').attributes("src")).toBe("/cover.jpg"),
    );
    expect(wrapper.find('[data-testid="queue-audio-placeholder"]').exists()).toBe(false);
    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="queue-audio-info"]').text()).toContain("2 声道");
    wrapper.unmount();
  });

  it.each(["bar", "card-fill", "ripple-card"] as const)(
    "places unknown activity at the card edge for %s",
    (progressStyle) => {
      const job = { ...makeJob(), waitMetadata: undefined, ffmpegCommand: "ffmpeg -i INPUT OUTPUT" };
      const wrapper = mount(QueueItem, {
        props: { job, preset, progressStyle },
        global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })] },
      });
      const activity = wrapper.get('[data-testid="queue-item-progress-indeterminate"]');
      const slot = wrapper.get('[data-testid="queue-item-activity-slot"]');
      expect(slot.classes()).toContain("absolute");
      expect(slot.classes()).toContain("bottom-0");
      expect(activity.element.parentElement).toBe(slot.element);
      expect(activity.attributes("aria-valuenow")).toBeUndefined();
      expect(activity.get("div").classes()).not.toContain("animate-pulse");
      expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(1);
      wrapper.unmount();
    },
  );

  it("keeps cover and measured progress semantics in icon and carousel views", () => {
    const job = makeJob();
    const global = { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })] };
    const icon = mount(QueueIconItem, { props: { job, size: "medium" }, global });
    const carousel = mount(QueueCarousel3DCardContent, {
      props: { item: { kind: "job", job }, previewUrl: null, displayFilename: job.filename, selected: false },
      global,
    });
    for (const wrapper of [icon, carousel]) {
      expect(wrapper.find('[data-testid="queue-audio-placeholder"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="queue-audio-info"]').text()).toContain("44.1 kHz");
      expect(wrapper.find('[data-testid="queue-item-progress-indeterminate"]').exists()).toBe(false);
      wrapper.unmount();
    }
    expect(hasIndeterminateQueueProgress(job)).toBe(false);
    expect(job.mediaInfo?.audio).toEqual(contract.mediaInfo.audio);
  });
});
