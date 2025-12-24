// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";
import { getPresetCommandPreview } from "@/lib/ffmpegCommand";

import PresetRowCompact from "./PresetRowCompact.vue";
import PresetCardGrid from "./PresetCardGrid.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const makePreset = (): FFmpegPreset => ({
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used for command preview formatting tests",
  video: {
    encoder: "hevc_nvenc",
    rateControl: "cq",
    qualityValue: 28,
    preset: "p5",
    pixFmt: "yuv420p",
    gop: 120,
    bframes: 3,
  } as any,
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("Preset command preview formatting", () => {
  it("renders PresetRowCompact preview without injected whitespace or '>' prefixes", () => {
    const preset = makePreset();
    const expected = getPresetCommandPreview(preset);

    const wrapper = mount(PresetRowCompact, {
      props: {
        preset,
        selected: false,
        onToggleSelect: () => {},
        onDuplicate: () => {},
        onExportPresetToFile: () => {},
        onEdit: () => {},
        onDelete: () => {},
      } as any,
      global: {
        plugins: [i18n],
      },
    });

    const pre = wrapper.get("pre");
    expect(pre.text()).toBe(expected);
    expect(pre.text().includes(">")).toBe(false);
    expect(pre.text()).toBe(pre.text().trim());
  });

  it("renders PresetCardGrid preview without injected whitespace or '>' prefixes", () => {
    const preset = makePreset();
    const expected = getPresetCommandPreview(preset);

    const wrapper = mount(PresetCardGrid, {
      props: {
        preset,
        selected: false,
        onToggleSelect: () => {},
        onDuplicate: () => {},
        onExportPresetToFile: () => {},
        onEdit: () => {},
        onDelete: () => {},
      } as any,
      global: {
        plugins: [i18n],
      },
    });

    const pre = wrapper.get("pre");
    expect(pre.text()).toBe(expected);
    expect(pre.text().includes(">")).toBe(false);
    expect(pre.text()).toBe(pre.text().trim());
  });
});
