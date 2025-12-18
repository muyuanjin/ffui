import { computed, type Ref } from "vue";
import type { AppSettings, OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

export function useQueueOutputPolicy(appSettings: Ref<AppSettings | null>) {
  const queueOutputPolicy = computed<OutputPolicy>(() => appSettings.value?.queueOutputPolicy ?? DEFAULT_OUTPUT_POLICY);

  const setQueueOutputPolicy = (policy: OutputPolicy) => {
    const current = appSettings.value;
    const nextSettings: AppSettings = {
      ...(current ?? ({ tools: {}, smartScanDefaults: {}, previewCapturePercent: 50 } as AppSettings)),
      queueOutputPolicy: policy,
    };
    appSettings.value = nextSettings;
  };

  return { queueOutputPolicy, setQueueOutputPolicy };
}
