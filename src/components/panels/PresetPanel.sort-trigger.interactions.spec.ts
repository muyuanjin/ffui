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

describe("PresetPanel sort trigger interactions", () => {
  it("opens the sort dropdown when clicking the trigger", async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.hasPointerCapture !== "function") {
      proto.hasPointerCapture = () => false;
    }
    if (typeof proto.releasePointerCapture !== "function") {
      proto.releasePointerCapture = () => {};
    }

    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
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
      attachTo: document.body,
    });

    const trigger = wrapper.get('button[role="combobox"]');
    await trigger.trigger("pointerdown");
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("true");

    wrapper.unmount();
  });
});
