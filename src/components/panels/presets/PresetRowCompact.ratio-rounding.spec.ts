// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";
import PresetRowCompact from "./PresetRowCompact.vue";

const makePreset = (overrides?: Partial<FFmpegPreset>): FFmpegPreset => ({
  id: "p1",
  name: "Preset 1",
  description: "Desc",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "aac" },
  filters: {},
  stats: {
    usageCount: 1,
    totalInputSizeMB: 100,
    totalOutputSizeMB: 99.6,
    totalTimeSeconds: 10,
  },
  ...(overrides ?? {}),
});

describe("PresetRowCompact ratio rounding", () => {
  it("uses the displayed rounded ratio for color thresholds", () => {
    const wrapper = mount(PresetRowCompact, {
      props: {
        preset: makePreset(),
        selected: false,
        predictedVmaf: null,
      },
      global: { plugins: [i18n] },
    });

    const ratio = wrapper.findAll("span.font-medium").find((el) => el.text().trim().endsWith("%"));
    expect(ratio?.exists()).toBe(true);
    expect(ratio!.text()).toBe("100%");
    expect(ratio!.classes()).toContain("text-amber-400");
    wrapper.unmount();
  });
});
