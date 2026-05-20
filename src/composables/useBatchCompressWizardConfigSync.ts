import { nextTick, ref, watch, type Ref } from "vue";
import type { BatchCompressConfig, FFmpegPreset } from "@/types";
import { buildBatchCompressConfig } from "@/lib/batchCompressConfig";

export function useBatchCompressWizardConfigSync(args: {
  config: Ref<BatchCompressConfig>;
  getInitialConfig: () => BatchCompressConfig | undefined;
  getPresets: () => FFmpegPreset[];
  getDefaultVideoPresetId: () => string | null | undefined;
}) {
  const isDirty = ref(false);
  const isSyncingInitialConfig = ref(false);
  const isProgrammaticConfigUpdate = ref(false);

  const syncConfig = (nextConfig: BatchCompressConfig) => {
    isSyncingInitialConfig.value = true;
    args.config.value = nextConfig;
    void nextTick(() => {
      isSyncingInitialConfig.value = false;
    });
  };

  const runProgrammaticConfigUpdate = (update: () => void) => {
    isProgrammaticConfigUpdate.value = true;
    update();
    void nextTick(() => {
      isProgrammaticConfigUpdate.value = false;
    });
  };

  watch(
    args.getInitialConfig,
    (newConfig) => {
      if (!newConfig) return;

      const nextConfig = buildBatchCompressConfig({
        presets: args.getPresets(),
        initialConfig: newConfig,
        defaultVideoPresetId: args.getDefaultVideoPresetId(),
      });

      if (!isDirty.value) {
        syncConfig(nextConfig);
        return;
      }

      if (!args.config.value.rootPath?.trim() && newConfig.rootPath) {
        isSyncingInitialConfig.value = true;
        args.config.value.rootPath = newConfig.rootPath;
        void nextTick(() => {
          isSyncingInitialConfig.value = false;
        });
      }
    },
    { immediate: true },
  );

  watch(
    args.config,
    () => {
      if (!isSyncingInitialConfig.value && !isProgrammaticConfigUpdate.value) {
        isDirty.value = true;
      }
    },
    { deep: true },
  );

  return { isSyncingInitialConfig, runProgrammaticConfigUpdate };
}
