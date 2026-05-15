import { computed, type ComputedRef } from "vue";
import type { TranscodeJob, Translate } from "@/types";
import { hasTauri } from "@/lib/backend";
import { getJobCompareDisabledReason, isJobCompareEligible } from "@/lib/jobCompare";

export function useJobCompareDisplay(job: ComputedRef<TranscodeJob>, t: Translate) {
  const compareDisabledReason = computed(() => {
    if (!hasTauri()) return "requires-tauri";
    return getJobCompareDisabledReason(job.value);
  });

  const canCompare = computed(() => isJobCompareEligible(job.value) && compareDisabledReason.value == null);

  const compareDisabledText = computed(() => {
    const reason = compareDisabledReason.value;
    if (!reason) return null;
    if (reason === "requires-tauri") return t("jobCompare.requiresTauri");
    if (reason === "not-video") return t("jobCompare.disabled.notVideo");
    if (reason === "status") return t("jobCompare.disabled.status");
    if (reason === "no-output") return t("jobCompare.disabled.noOutput");
    if (reason === "no-partial-output") return t("jobCompare.disabled.noPartialOutput");
    return t("jobCompare.disabled.unavailable");
  });

  return { canCompare, compareDisabledText };
}
