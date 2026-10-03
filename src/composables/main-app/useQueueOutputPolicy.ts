import { computed } from "vue";
import type { AppSettings, OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

export function useQueueOutputPolicy(
  getOutputPolicy: () => OutputPolicy | undefined,
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<void>,
) {
  const queueOutputPolicy = computed<OutputPolicy>(() => getOutputPolicy() ?? DEFAULT_OUTPUT_POLICY);

  const setQueueOutputPolicy = (policy: OutputPolicy) => {
    void updateAppSettings({ queueOutputPolicy: policy });
  };

  return { queueOutputPolicy, setQueueOutputPolicy };
}
