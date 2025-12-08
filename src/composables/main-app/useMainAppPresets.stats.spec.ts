// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import { useMainAppPresets } from "./useMainAppPresets";

const makePreset = (): FFmpegPreset => ({
  id: "p-stats-1",
  name: "Stats Test Preset",
  description: "Preset used for stats aggregation tests",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("useMainAppPresets stats aggregation", () => {
  it("updatePresetStats aggregates stats for the target preset", () => {
    const presets = ref<FFmpegPreset[]>([makePreset()]);
    const presetsLoadedFromBackend = ref(false);
    const manualJobPresetId = ref<string | null>(null);

    const wrapper = mount({
      setup() {
        const composable = useMainAppPresets({
          t: (key: string) => key,
          presets,
          presetsLoadedFromBackend,
          manualJobPresetId,
          // dialogManager / shell are unused in this test; pass minimal stubs.
          dialogManager: {
            openParameterPanel: () => {},
            closeParameterPanel: () => {},
            closeWizard: () => {},
          } as any,
          shell: undefined,
        });
        return { composable };
      },
      template: "<div />",
    });

    const { composable } = wrapper.vm as unknown as {
      composable: ReturnType<typeof useMainAppPresets>;
    };

    const { updatePresetStats } = composable;

    const targetId = presets.value[0].id;
    updatePresetStats(targetId, 100, 40, 20);

    const updated = presets.value[0];
    expect(updated.stats.usageCount).toBe(1);
    expect(updated.stats.totalInputSizeMB).toBeCloseTo(100);
    expect(updated.stats.totalOutputSizeMB).toBeCloseTo(40);
    expect(updated.stats.totalTimeSeconds).toBeCloseTo(20);
    wrapper.unmount();
  });
});
