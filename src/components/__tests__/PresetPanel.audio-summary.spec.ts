// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";

const makePreset = (id: string, audio: FFmpegPreset["audio"]): FFmpegPreset => ({
  id,
  name: `Preset ${id}`,
  description: `Desc ${id}`,
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio,
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("PresetPanel 音频摘要展示", () => {
  it("copy 模式显示为“复制”", async () => {
    // 切换到中文，以便断言中文文案
    (i18n.global.locale as any).value = "zh-CN";
    const wrapper = mount(PresetPanel, {
      props: {
        presets: [makePreset("p1", { codec: "copy" })],
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("复制");
    wrapper.unmount();
  });

  it("AAC 无比特率时显示为 'AAC' 而不是 'AAC 0k'", () => {
    const wrapper = mount(PresetPanel, {
      props: {
        presets: [makePreset("p1", { codec: "aac" })],
      },
      global: { plugins: [i18n] },
    });

    const text = wrapper.text();
    expect(text).toContain("AAC");
    expect(text.includes("AAC 0k")).toBe(false);
    wrapper.unmount();
  });

  it("AAC 有比特率时显示 'AAC 192k'", () => {
    const wrapper = mount(PresetPanel, {
      props: {
        presets: [makePreset("p1", { codec: "aac", bitrate: 192 })],
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("AAC 192k");
    wrapper.unmount();
  });
});
