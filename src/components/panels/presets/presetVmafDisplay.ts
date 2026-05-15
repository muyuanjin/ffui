import { computed } from "vue";
import type { FFmpegPreset, Translate } from "@/types";
import { toFixedDisplay } from "@/lib/numberDisplay";

type UsePresetVmafDisplayOptions = {
  preset: () => FFmpegPreset;
  predictedVmaf: () => number | null | undefined;
  t: Translate;
  include95Hint?: boolean;
};

export function usePresetVmafDisplay(options: UsePresetVmafDisplayOptions) {
  const predictedVmafText = computed(() => {
    const v = options.predictedVmaf();
    return toFixedDisplay(v, 2)?.text ?? "—";
  });

  const measuredVmaf = computed(() => {
    const stats = options.preset().stats;
    const c = Number(stats.vmafCount ?? 0);
    const sum = Number(stats.vmafSum ?? 0);
    if (!Number.isFinite(c) || c <= 0) return null;
    if (!Number.isFinite(sum)) return null;
    return sum / c;
  });

  const measuredVmafText = computed(() => {
    const v = measuredVmaf.value;
    if (v == null || !Number.isFinite(v)) return null;
    return toFixedDisplay(v, 2)?.text ?? null;
  });

  const measuredVmafCount = computed(() => {
    const c = Number(options.preset().stats.vmafCount ?? 0);
    if (!Number.isFinite(c) || c <= 0) return null;
    return Math.floor(c);
  });

  const vmafDisplayValue = computed<number | null>(() => {
    const measured = measuredVmaf.value;
    if (typeof measured === "number" && Number.isFinite(measured)) {
      return toFixedDisplay(measured, 2)?.value ?? null;
    }
    const predicted = options.predictedVmaf();
    if (typeof predicted === "number" && Number.isFinite(predicted)) {
      return toFixedDisplay(predicted, 2)?.value ?? null;
    }
    return null;
  });

  const vmaf95Plus = computed(() => {
    const v = vmafDisplayValue.value;
    return typeof v === "number" && Number.isFinite(v) && v >= 95;
  });

  const vmafTitle = computed(() => {
    const parts: string[] = [];
    const mean = measuredVmafText.value;
    if (mean) {
      const c = measuredVmafCount.value;
      parts.push(
        c
          ? options.t("presets.vmafTooltipMeasuredWithCount", { value: mean, count: c })
          : options.t("presets.vmafTooltipMeasured", { value: mean }),
      );
    } else if (predictedVmafText.value !== "—") {
      parts.push(options.t("presets.vmafTooltipPredicted", { value: predictedVmafText.value }));
    }
    if (options.include95Hint && vmaf95Plus.value) {
      parts.push(options.t("presets.vmafHint95"));
    }
    return parts.join(" · ") || "VMAF";
  });

  return {
    predictedVmafText,
    measuredVmaf,
    measuredVmafText,
    measuredVmafCount,
    vmafDisplayValue,
    vmaf95Plus,
    vmafTitle,
  };
}
