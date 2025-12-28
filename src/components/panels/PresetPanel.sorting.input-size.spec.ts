// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";

import PresetPanel from "./PresetPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";

const makePreset = (id: string, name: string, totalInputSizeMB: number): FFmpegPreset => ({
  id,
  name,
  description: "",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  } as any,
  audio: {
    codec: "copy",
  } as any,
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  global: undefined,
  input: undefined,
  mapping: undefined,
  subtitles: undefined,
  container: undefined,
  hardware: undefined,
  advancedEnabled: undefined,
  ffmpegTemplate: undefined,
  isSmartPreset: undefined,
});

describe("PresetPanel sorting", () => {
  it("renders presets in input-size order when sortMode=inputSize", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: en as any,
        "zh-CN": zhCN as any,
      },
    });

    const wrapper = mount(PresetPanel, {
      props: {
        presets: [makePreset("preset-small", "Small", 10), makePreset("preset-large", "Large", 250)],
        sortMode: "inputSize",
        viewMode: "grid",
      },
      global: {
        plugins: [i18n],
      },
    });

    await nextTick();

    const cards = wrapper.findAll('[data-testid="preset-card-root"]');
    expect(cards[0]?.attributes("data-preset-id")).toBe("preset-large");
    expect(cards[1]?.attributes("data-preset-id")).toBe("preset-small");

    wrapper.unmount();
  });
});
