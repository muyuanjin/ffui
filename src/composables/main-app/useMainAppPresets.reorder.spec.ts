// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import type { FFmpegPreset } from "@/types";
import { useMainAppPresets } from "./useMainAppPresets";

const makePreset = (id: string, name: string): FFmpegPreset => ({
  id,
  name,
  description: name,
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

describe("useMainAppPresets handleReorderPresets", () => {
  it("reorders local presets according to orderedIds even without Tauri backend", async () => {
    const presets = ref<FFmpegPreset[]>([
      makePreset("p1", "One"),
      makePreset("p2", "Two"),
      makePreset("p3", "Three"),
    ]);
    const presetsLoadedFromBackend = ref(false);
    const manualJobPresetId = ref<string | null>(null);

    const { handleReorderPresets } = useMainAppPresets({
      t: (key: string) => key,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await handleReorderPresets(["p3", "p1", "p2"]);

    expect(presets.value.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });
});

