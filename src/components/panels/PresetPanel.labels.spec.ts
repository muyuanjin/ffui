// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import PresetPanel from "./PresetPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";

// 预设面板内部使用 useSortable，这里在 jsdom 环境下无需真实拖拽行为，直接使用默认实现即可。

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const makeBasePreset = (partial: Partial<FFmpegPreset>): FFmpegPreset => {
  return {
    id: "preset-1",
    name: "Test Preset",
    description: "Test description",
    video: {
      encoder: "libx264",
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
      ...(partial.video ?? {}),
    },
    audio: {
      codec: "copy",
      ...(partial.audio ?? {}),
    },
    filters: partial.filters ?? {},
    stats: {
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
      ...(partial.stats ?? {}),
    },
    global: partial.global,
    input: partial.input,
    mapping: partial.mapping,
    subtitles: partial.subtitles,
    container: partial.container,
    hardware: partial.hardware,
    advancedEnabled: partial.advancedEnabled,
    ffmpegTemplate: partial.ffmpegTemplate,
    isSmartPreset: partial.isSmartPreset,
  };
};

describe("PresetPanel scenario and risk labels", () => {
  it("shows lossless scenario and risk badge for AV1 NVENC ConstQP18 presets", () => {
    const presets: FFmpegPreset[] = [
      makeBasePreset({
        id: "smart-av1-nvenc-hq-constqp18",
        name: "AV1 NVENC HQ ConstQP18",
        description: "RTX40+/Ada near-lossless AV1 constqp18",
        video: {
          encoder: "av1_nvenc",
          rateControl: "constqp",
          qualityValue: 18,
          preset: "p7",
        } as any,
      }),
    ];

    const wrapper = mount(PresetPanel, {
      props: {
        presets,
        sortMode: "manual",
        viewMode: "grid",
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();

    // 场景应显示为“Visually (near) lossless”
    expect(text).toContain("Visually (near) lossless");
    // 同时应显示“May increase size”的体积风险提示
    expect(text).toContain("May increase size");

    wrapper.unmount();
  });
});

