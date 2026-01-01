// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";
import PresetRowCompact from "@/components/panels/presets/PresetRowCompact.vue";
import PresetCardFooterStats from "@/components/panels/presets/PresetCardFooterStats.vue";
import PresetCardFooterVmafStat from "@/components/panels/presets/PresetCardFooterVmafStat.vue";

const makePreset = (overrides?: Partial<FFmpegPreset>): FFmpegPreset => ({
  id: "p1",
  name: "Preset 1",
  description: "Desc",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: { codec: "aac" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
  ...(overrides ?? {}),
});

describe("Preset VMAF display (measured-only)", () => {
  const originalLocale = i18n.global.locale.value;
  beforeEach(() => {
    i18n.global.locale.value = "zh-CN";
  });
  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it("PresetCardFooterVmafStat: measured hides predicted", () => {
    const wrapper = mount(PresetCardFooterVmafStat, {
      props: {
        show: true,
        title: "VMAF",
        vmaf95Plus: false,
        predictedVmafText: "88.8",
        measuredVmafText: "93.2",
        measuredVmafCount: 5,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("93.2");
    expect(wrapper.text()).not.toContain("88.8");
    wrapper.unmount();
  });

  it("PresetRowCompact: measured hides predicted + title omits pred", () => {
    const wrapper = mount(PresetRowCompact, {
      props: {
        preset: makePreset({
          stats: {
            usageCount: 0,
            totalInputSizeMB: 0,
            totalOutputSizeMB: 0,
            totalTimeSeconds: 0,
            vmafCount: 5,
            vmafSum: 466,
          },
        }),
        selected: false,
        predictedVmaf: 88.8,
      },
      global: { plugins: [i18n] },
    });

    const vmaf = wrapper.get('[data-testid="preset-row-vmaf"]');
    expect(vmaf.text()).toContain("93.20");
    expect(vmaf.text()).not.toContain("88.8");
    expect(String(vmaf.attributes("title") ?? "")).toContain("实测均值");
    expect(String(vmaf.attributes("title") ?? "")).toContain("93.20");
    expect(String(vmaf.attributes("title") ?? "")).toContain("5");
    expect(String(vmaf.attributes("title") ?? "")).not.toContain("预测");
    expect(String(vmaf.attributes("title") ?? "")).not.toContain("88.8");
    wrapper.unmount();
  });

  it("PresetCardFooterStats: measured hides predicted + tooltip omits pred", () => {
    const wrapper = mount(PresetCardFooterStats, {
      props: {
        preset: makePreset({
          stats: {
            usageCount: 0,
            totalInputSizeMB: 0,
            totalOutputSizeMB: 0,
            totalTimeSeconds: 0,
            vmafCount: 5,
            vmafSum: 466,
          },
        }),
        predictedVmaf: 88.8,
        footerSettings: { showVmaf: true },
      },
      global: { plugins: [i18n] },
    });

    const vmaf = wrapper.get('[data-testid="preset-footer-vmaf-stat"]');
    expect(vmaf.text()).toContain("93.20");
    expect(vmaf.text()).not.toContain("88.8");
    expect(String(vmaf.attributes("title") ?? "")).toContain("实测均值");
    expect(String(vmaf.attributes("title") ?? "")).toContain("93.20");
    expect(String(vmaf.attributes("title") ?? "")).toContain("5");
    expect(String(vmaf.attributes("title") ?? "")).not.toContain("预测");
    expect(String(vmaf.attributes("title") ?? "")).not.toContain("88.8");
    wrapper.unmount();
  });
});
