// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";

import PresetPanel from "./PresetPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";

const ensurePointerCaptureApi = () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== "function") proto.hasPointerCapture = () => false;
  if (typeof proto.releasePointerCapture !== "function") proto.releasePointerCapture = () => {};
};

const makePreset = (id: string, name: string): FFmpegPreset => ({
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

describe("PresetPanel sort mode apply timing", () => {
  it("applies list sorting immediately after selecting a sort mode", async () => {
    ensurePointerCaptureApi();

    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: { en: en as any, "zh-CN": zhCN as any },
    });

    const wrapper = mount(PresetPanel, {
      props: {
        presets: [makePreset("a", "B"), makePreset("b", "A")],
        sortMode: "manual",
        viewMode: "compact",
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });

    const getRowIds = () =>
      wrapper.findAll('[data-testid="preset-card-root"]').map((row) => String(row.attributes("data-preset-id") ?? ""));

    expect(getRowIds()).toEqual(["a", "b"]);

    wrapper.findComponent({ name: "SelectRoot" }).vm.$emit("update:modelValue", "name");
    await nextTick();

    expect(getRowIds()).toEqual(["b", "a"]);

    wrapper.unmount();
  });
});
