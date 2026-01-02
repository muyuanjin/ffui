// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";
import PresetCardFooterStats from "@/components/panels/presets/PresetCardFooterStats.vue";

const makePreset = (overrides?: Partial<FFmpegPreset>): FFmpegPreset => ({
  id: "p1",
  name: "Preset 1",
  description: "Desc",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: { codec: "aac" },
  filters: {},
  stats: {
    usageCount: 128,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  ...(overrides ?? {}),
});

describe("PresetCardFooterStats - usedCount i18n", () => {
  const originalLocale = i18n.global.locale.value;
  beforeEach(() => {
    i18n.global.locale.value = "zh-CN";
  });
  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it("renders unit by locale and updates after switching locale", async () => {
    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset(),
        footerSettings: {
          layout: "twoRows",
          order: ["usedCount"],
          showAvgSize: false,
          showFps: false,
          showVmaf: false,
          showUsedCount: true,
          showDataAmount: false,
          showThroughput: false,
        },
      },
      global: { plugins: [i18n] },
    });

    const usedCount = wrapper.get('[data-footer-item="usedCount"]');
    expect(usedCount.text()).toContain("128");
    expect(usedCount.text()).toContain("次");

    i18n.global.locale.value = "en";
    await nextTick();
    await nextTick();

    expect(usedCount.text()).toContain("128");
    expect(usedCount.text()).toContain("×");
    expect(usedCount.text()).not.toContain("次");
    wrapper.unmount();
  });
});
