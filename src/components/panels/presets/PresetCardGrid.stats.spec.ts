// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset } from "@/types";
import PresetCardGrid from "./PresetCardGrid.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("PresetCardGrid stats", () => {
  const mountPresetCard = (preset: FFmpegPreset) =>
    mount(PresetCardGrid, {
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

  it("shows MB/s throughput and FPS together when both are available", () => {
    const preset: FFmpegPreset = {
      id: "preset-stats-1",
      name: "Preset Stats",
      description: "Preset used for PresetCardGrid stats tests",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      stats: {
        usageCount: 1,
        totalInputSizeMB: 120,
        totalOutputSizeMB: 60,
        totalTimeSeconds: 10,
        totalFrames: 600,
      },
    };

    const wrapper = mountPresetCard(preset);

    const text = wrapper.text();
    expect(text).toContain("MB/s");
    expect(text).toContain("FPS");
  });

  it("only shows the 2-pass badge for structured two-pass video with positive target bitrate", () => {
    const basePreset: FFmpegPreset = {
      id: "preset-two-pass-badge",
      name: "Preset Two Pass Badge",
      description: "Preset used for two-pass badge tests",
      video: {
        encoder: "libx264",
        rateControl: "vbr",
        qualityValue: 23,
        preset: "medium",
        pass: 2,
      },
      audio: { codec: "copy" },
      filters: {},
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };

    expect(mountPresetCard(basePreset).text()).not.toContain("2-pass");
    expect(
      mountPresetCard({
        ...basePreset,
        video: {
          ...basePreset.video,
          bitrateKbps: 3000,
        },
      }).text(),
    ).toContain("2-pass");
  });
});
