import { ref, watch, type Ref } from "vue";
import type { FFmpegPreset } from "@/types";
import { fetchGpuUsage, hasTauri } from "@/lib/backend";
import { loadVqResultsSnapshot } from "@/lib/vqResults/client";
import { predictFromVqResults } from "@/lib/vqResults/predict";

export const usePredictedVmafByPresetId = (presets: Ref<FFmpegPreset[]>) => {
  const isVitest = typeof process !== "undefined" && Boolean((process as any)?.env?.VITEST);

  const vqHardwareModelName = ref<string | null>(null);
  const predictedVmafByPresetId = ref<Map<string, number | null>>(new Map());

  const ensureHardwareModelName = async (): Promise<string | null> => {
    if (!hasTauri()) return null;
    if (vqHardwareModelName.value != null) return vqHardwareModelName.value;
    try {
      const gpu = await fetchGpuUsage();
      vqHardwareModelName.value = gpu.model ?? null;
    } catch {
      vqHardwareModelName.value = null;
    }
    return vqHardwareModelName.value;
  };

  const recomputePredictedVmaf = async () => {
    if (isVitest) return;
    const nextPresets = presets.value;
    if (!nextPresets.length) {
      predictedVmafByPresetId.value = new Map();
      return;
    }
    try {
      const snapshot = await loadVqResultsSnapshot();

      const needsNvHint = nextPresets.some((p) =>
        String(p.video?.encoder ?? "")
          .toLowerCase()
          .includes("nvenc"),
      );
      const hardwareModelNameHint = needsNvHint ? await ensureHardwareModelName() : null;

      const out = new Map<string, number | null>();
      for (const p of nextPresets) {
        const key = p.id;
        const predicted =
          String(p.video?.encoder ?? "") === "copy"
            ? null
            : predictFromVqResults(snapshot, p, { hardwareModelNameHint });
        const vmaf = predicted?.vmaf?.value;
        out.set(key, typeof vmaf === "number" && Number.isFinite(vmaf) ? vmaf : null);
      }
      predictedVmafByPresetId.value = out;
    } catch (e) {
      console.error("PresetPanel: failed to load quality snapshot data", e);
      predictedVmafByPresetId.value = new Map();
    }
  };

  watch(
    () =>
      presets.value.map((p) => [
        p.id,
        p.video?.encoder,
        p.video?.rateControl,
        p.video?.qualityValue,
        p.video?.preset,
        (p.video as any)?.pixFmt,
      ]),
    () => {
      void recomputePredictedVmaf();
    },
    { immediate: true, deep: true },
  );

  return {
    predictedVmafByPresetId,
    recomputePredictedVmaf,
  };
};
