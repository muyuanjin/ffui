// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputPolicy } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainContentHeader output container badge + hover preview", () => {
  it("does not present the unified preset container as a universal default when input routes differ", () => {
    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: "video",
        queueViewModeModel: "detail",
        queuePresetSelection: { mode: "byMedia", video: "extract" },
        queueOutputPolicy: {
          container: { mode: "default" },
          directory: { mode: "sameAsInput" },
          filename: { suffix: ".compressed" },
        },
        presets: [
          { id: "video", name: "Video", container: { format: "mp4" } },
          {
            id: "extract",
            name: "Extract",
            advancedEnabled: true,
            ffmpegTemplate: "ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT",
          },
        ] as any,
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: "<div><slot /></div>" },
          HoverCardTrigger: { template: "<div><slot /></div>" },
          HoverCardContent: { template: "<div><slot /></div>" },
          Dialog: true,
        },
      },
    });
    expect(wrapper.get('[data-testid="ffui-queue-output-container-badge"]').text()).toBe("auto");
    const preview = wrapper.get('[data-testid="ffui-queue-output-settings-hover-preview"]').text();
    expect(preview).toContain("input.compressed.mp3");
    expect(preview).not.toContain("Default (follow preset/template)（mp4）");
    wrapper.unmount();
  });
  it("extends three labeled badges left of output settings and collapses unified policies to one", async () => {
    const localI18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
    const policy: OutputPolicy = {
      container: { mode: "byMedia", video: "mkv", audio: "mp3", image: "png" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
    };
    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 3,
        completedCount: 1,
        manualJobPresetId: null,
        presets: [],
        queueViewModeModel: "detail",
        queueOutputPolicy: policy,
      },
      global: {
        plugins: [localI18n],
        stubs: {
          HoverCard: { template: "<div><slot /></div>" },
          HoverCardTrigger: { template: "<div><slot /></div>" },
          HoverCardContent: { template: "<div><slot /></div>" },
          Dialog: true,
        },
      },
    });
    const badges = () => wrapper.findAll('[data-testid="ffui-queue-output-container-badge"]');
    expect(wrapper.get("header").classes()).toContain("flex-wrap");
    const count = wrapper.get('[data-testid="ffui-queue-job-count"]');
    expect(count.text()).toBe("1 / 3");
    expect(count.classes()).toContain("whitespace-nowrap");
    expect(count.classes()).toContain("shrink-0");
    expect(wrapper.get('[data-testid="ffui-queue-view-mode-trigger"]').classes()).toContain("w-auto");
    expect(badges().map((badge) => badge.attributes("data-media-kind"))).toEqual(["video", "audio", "image"]);
    expect(badges().map((badge) => badge.get(".sr-only").text())).toEqual(["Video", "Audio", "Image"]);
    expect(badges().map((badge) => badge.get(".truncate").text())).toEqual(["mkv", "mp3", "png"]);
    expect(badges()[0].classes()).toContain("rounded-l-full");
    for (const badge of badges()) {
      expect(badge.classes()).toContain("min-w-0");
      expect(badge.get(".truncate").classes()).toContain("truncate");
      expect(badge.get("svg").attributes("aria-hidden")).toBe("true");
      expect(badge.attributes("aria-label")).toBe(badge.attributes("title"));
    }
    expect(badges()[1].classes()).not.toContain("rounded-l-full");
    expect(badges()[2].element.nextElementSibling?.getAttribute("data-testid")).toBe("ffui-queue-output-settings");
    const preview = wrapper.get('[data-testid="ffui-queue-output-settings-hover-preview"]');
    expect(preview.text()).toContain("input.compressed.mkv");
    expect(preview.text()).toContain("input.compressed.mp3");
    expect(preview.text()).toContain("input.compressed.png");
    localI18n.global.locale.value = "zh-CN";
    await flushPromises();
    expect(badges().map((badge) => badge.get(".sr-only").text())).toEqual(["视频", "音频", "图片"]);
    expect(badges().map((badge) => badge.get(".truncate").text())).toEqual(["mkv", "mp3", "png"]);
    await wrapper.setProps({ queueOutputPolicy: { ...policy, container: { mode: "byMedia", audio: "mp3" } } });
    expect(badges()[0].text()).toContain("auto");
    expect(badges()[0].attributes("title")).toContain("跟随预设/模板");
    await wrapper.setProps({
      queueOutputPolicy: { ...policy, container: { mode: "byMedia", video: "webm", audio: "mp3" } },
      presets: [{ id: "webm", name: "H264/AAC", video: { encoder: "libx264" }, audio: { codec: "aac" } } as any],
    });
    expect(preview.text()).toContain("input.compressed.mkv");
    expect(preview.text()).not.toContain("input.compressed.webm");
    for (const mode of ["default", "keepInput"] as const) {
      await wrapper.setProps({ queueOutputPolicy: { ...policy, container: { mode } } });
      expect(badges()).toHaveLength(1);
      expect(badges()[0].text()).toBe(mode === "default" ? "auto" : "input");
    }
    wrapper.unmount();
  });
  it("renders container badge left of output settings and shows a compact preview", () => {
    const DialogStub = defineComponent({
      name: "Dialog",
      props: { open: { type: Boolean, default: false } },
      template: `<div v-if="open"><slot /></div>`,
    });

    const policy: OutputPolicy = {
      container: { mode: "force", format: "mkv" },
      directory: { mode: "fixed", directory: "D:/Outputs" },
      filename: { prefix: "P-", suffix: ".compressed", appendTimestamp: true, randomSuffixLen: 6 },
      preserveFileTimes: { created: true, modified: true, accessed: false },
    };

    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: "p1",
        presets: [{ id: "p1", name: "Universal 1080p" } as any],
        queueViewModeModel: "detail",
        presetSortMode: "manual",
        queueOutputPolicy: policy,
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: `<div><slot /></div>` },
          HoverCardTrigger: { template: `<div><slot /></div>` },
          HoverCardContent: { template: `<div><slot /></div>` },
          Dialog: DialogStub,
          DialogContent: { template: `<div><slot /></div>` },
          DialogHeader: { template: `<div><slot /></div>` },
          DialogTitle: { template: `<div><slot /></div>` },
          OutputPolicyEditor: { template: `<div />` },
          Select: { template: `<div><slot /></div>` },
          SelectContent: { template: `<div><slot /></div>` },
          SelectItem: { template: `<div><slot /></div>` },
          SelectTrigger: { template: `<div><slot /></div>` },
          SelectValue: { template: `<div><slot /></div>` },
        },
      },
    });

    const badge = wrapper.get("[data-testid='ffui-queue-output-container-badge']");
    expect(badge.text()).toBe("mkv");

    const preview = wrapper.get("[data-testid='ffui-queue-output-settings-hover-preview']");
    expect(preview.text()).toContain("Preview");
    expect(preview.text()).toContain("Output Container");
    expect(preview.text()).toContain("mkv");
    expect(preview.text()).toContain("Unified format");
    expect(preview.text()).toContain("Fixed directory");
    expect(preview.text()).toContain("D:/Outputs");
    expect(preview.text()).not.toContain("prefix=");
    expect(preview.text()).not.toContain("suffix=");
  });
});
