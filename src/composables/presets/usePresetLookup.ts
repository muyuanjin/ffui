import { computed } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";

export const usePresetLookup = (getPresets: () => readonly FFmpegPreset[]) => {
  const fallbackPreset = computed<FFmpegPreset>(() => {
    const presets = getPresets();
    if (presets.length > 0) return presets[0];
    return {
      id: "default",
      name: "Default",
      description: "",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };
  });

  const presetById = computed(() => {
    return new Map(getPresets().map((preset) => [preset.id, preset] as const));
  });

  const resolvePresetId = (presetId: string): FFmpegPreset => {
    return presetById.value.get(presetId) ?? fallbackPreset.value;
  };

  const resolvePresetForJob = (job: Pick<TranscodeJob, "presetId">): FFmpegPreset => {
    return resolvePresetId(job.presetId);
  };

  return { fallbackPreset, presetById, resolvePresetId, resolvePresetForJob };
};
