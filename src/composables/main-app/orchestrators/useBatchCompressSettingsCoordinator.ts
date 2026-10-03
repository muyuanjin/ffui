import type { BatchCompressConfig } from "@/types";
import type { SettingsDomain } from "@/MainApp.types";
import type { UseMainAppBatchCompressReturn } from "@/composables/main-app/useMainAppBatchCompress";
import { hasTauri } from "@/lib/backend";

export function useBatchCompressSettingsCoordinator(
  batchCompress: UseMainAppBatchCompressReturn,
  settings: SettingsDomain,
): UseMainAppBatchCompressReturn {
  const runBatchCompress = async (config: BatchCompressConfig) => {
    if (!hasTauri()) return batchCompress.runBatchCompress(config);
    await settings.updateAppSettings({ batchCompressDefaults: config });
    await batchCompress.runBatchCompress(config);
    await settings.updateAppSettings({ batchCompressDefaults: batchCompress.smartConfig.value });
  };
  return { ...batchCompress, runBatchCompress };
}
