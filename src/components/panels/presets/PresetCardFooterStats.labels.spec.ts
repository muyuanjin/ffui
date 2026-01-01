// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, PresetCardFooterSettings } from "@/types";
import PresetCardFooterStats from "./PresetCardFooterStats.vue";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const makePreset = (): FFmpegPreset => ({
  id: "preset-footer-stats-1",
  name: "Preset Footer Stats",
  description: "Preset used for footer stats tests",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 17,
    totalInputSizeMB: 2355,
    totalOutputSizeMB: 612,
    totalTimeSeconds: 10,
    totalFrames: 600,
    vmafCount: 1,
    vmafSum: 95.3,
  },
});

describe("PresetCardFooterStats labels", () => {
  it("uses short labels in oneRow when enabled items > 3", () => {
    const footerSettings: PresetCardFooterSettings = {
      layout: "oneRow",
      showAvgSize: true,
      showFps: true,
      showVmaf: true,
      showUsedCount: true,
      showDataAmount: true,
      showThroughput: true,
    };

    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset(),
        predictedVmaf: 95.3,
        footerSettings,
      },
      global: { plugins: [i18n] },
    });

    const text = wrapper.text();
    expect(text).toContain("大小");
    expect(text).toContain("已用");
    expect(text).toContain("输入");
    expect(text).toContain("吞吐");
  });

  it("uses full labels in oneRow when enabled items <= 3", () => {
    const footerSettings: PresetCardFooterSettings = {
      layout: "oneRow",
      showAvgSize: false,
      showFps: false,
      showVmaf: false,
      showUsedCount: true,
      showDataAmount: true,
      showThroughput: true,
    };

    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset(),
        predictedVmaf: 95.3,
        footerSettings,
      },
      global: { plugins: [i18n] },
    });

    const text = wrapper.text();
    expect(text).toContain("已用次数");
    expect(text).toContain("数据量");
    expect(text).toContain("吞吐量");
  });

  it("balances break order in twoRows (4 items -> 2+2)", () => {
    const footerSettings: PresetCardFooterSettings = {
      layout: "twoRows",
      showAvgSize: true,
      showFps: false,
      showVmaf: true,
      showUsedCount: false,
      showDataAmount: true,
      showThroughput: true,
    };

    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset(),
        predictedVmaf: 95.3,
        footerSettings,
      },
      global: { plugins: [i18n] },
    });

    const br = wrapper.find("[data-testid='preset-card-footer-break']");
    expect(br.exists()).toBe(true);
    expect((br.element as HTMLElement).style.order).toBe("3");
  });
});
