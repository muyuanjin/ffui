// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";

import PresetPanel from "./PresetPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";

const makePreset = (): FFmpegPreset => ({
  id: "preset-1",
  name: "Test Preset",
  description: "Test description",
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
    totalInputSizeMB: 0,
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

describe("PresetPanel 语言切换", () => {
  it("排序下拉在切换语言后无需再次点击即可显示新文案", async () => {
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
        presets: [makePreset()],
        sortMode: "manual",
        viewMode: "grid",
      },
      global: {
        plugins: [i18n],
      },
    });

    await nextTick();

    const trigger = wrapper.get('button[role="combobox"]');
    expect(trigger.text()).toContain("Manual");

    i18n.global.locale.value = "zh-CN";
    await nextTick();
    await nextTick();

    const triggerAfter = wrapper.get('button[role="combobox"]');
    expect(triggerAfter.text()).toContain("手动排序");

    wrapper.unmount();
  });

  it("内置预设标签在切换语言后立即更新", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: en as any,
        "zh-CN": zhCN as any,
      },
    });

    const smartPreset: FFmpegPreset = {
      ...makePreset(),
      id: "smart-av1-nvenc-hq-constqp18",
      isSmartPreset: true,
    };

    const wrapper = mount(PresetPanel, {
      props: {
        presets: [smartPreset],
        sortMode: "manual",
        viewMode: "grid",
      },
      global: {
        plugins: [i18n],
      },
    });

    await nextTick();
    expect(wrapper.text()).toContain("Built-in");

    i18n.global.locale.value = "zh-CN";
    await nextTick();
    await nextTick();
    expect(wrapper.text()).toContain("内置");

    wrapper.unmount();
  });
});
