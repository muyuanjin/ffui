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

const makePreset = (vmafMean: number): FFmpegPreset => ({
  id: "preset-footer-vmaf-rounding-1",
  name: "Preset Footer VMAF Rounding",
  description: "Preset used for VMAF rounding tests",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
    totalFrames: 0,
    vmafCount: 1,
    vmafSum: vmafMean,
  },
});

describe("PresetCardFooterStats VMAF rounding", () => {
  it("keeps the ★ highlight consistent with the displayed rounded value", () => {
    const footerSettings: PresetCardFooterSettings = {
      layout: "oneRow",
      order: ["vmaf"],
      showAvgSize: false,
      showFps: false,
      showVmaf: true,
      showUsedCount: false,
      showDataAmount: false,
      showThroughput: false,
    };

    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset(94.996),
        predictedVmaf: null,
        footerSettings,
      },
      global: { plugins: [i18n] },
    });

    const vmaf = wrapper.get("[data-testid='preset-footer-vmaf-stat']");
    expect(vmaf.text()).toContain("95.00");
    expect(vmaf.text()).toContain("★");
  });
});
