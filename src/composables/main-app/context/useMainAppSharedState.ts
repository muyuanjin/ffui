import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset, PresetSortDirection, PresetSortMode, PresetViewMode, TranscodeJob } from "@/types";
import { getDefaultPresetSortDirection } from "@/lib/presetSorter";
import { scheduleStartupIdle } from "@/composables/main-app/startupIdle";

export function useMainAppSharedState() {
  const { t, locale } = useI18n();
  const jobs = ref<TranscodeJob[]>([]);
  const queueError = ref<string | null>(null);
  const lastQueueSnapshotAtMs = ref<number | null>(null);
  const lastQueueSnapshotRevision = ref<number | null>(null);
  const lastDroppedRoot = ref<string | null>(null);
  const presets = ref<FFmpegPreset[]>([]);
  const presetsLoadedFromBackend = ref(false);
  const manualJobPresetId = ref<string | null>(null);
  const presetSortMode = ref<PresetSortMode>("manual");
  const presetSortDirection = ref<PresetSortDirection>(getDefaultPresetSortDirection(presetSortMode.value));
  const presetViewMode = ref<PresetViewMode>("grid");
  const completedCount = computed(() => jobs.value.filter((job) => job.status === "completed").length);
  const startupIdleReady = ref(false);
  const isTestEnv =
    typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

  if (isTestEnv || typeof window === "undefined") {
    startupIdleReady.value = true;
  } else {
    const rawTimeoutMs =
      typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
        ? Number(import.meta.env.VITE_STARTUP_IDLE_TIMEOUT_MS)
        : NaN;
    const idleTimeoutMs = Number.isFinite(rawTimeoutMs) ? rawTimeoutMs : 1200;

    scheduleStartupIdle(
      () => {
        if (typeof performance !== "undefined" && "mark" in performance) {
          performance.mark("startup_idle_ready");
        }
        startupIdleReady.value = true;
      },
      { timeoutMs: idleTimeoutMs },
    );
  }

  return {
    t,
    locale,
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
    lastDroppedRoot,
    presets,
    presetsLoadedFromBackend,
    manualJobPresetId,
    presetSortMode,
    presetSortDirection,
    presetViewMode,
    completedCount,
    startupIdleReady,
    isTestEnv,
  };
}

export type MainAppSharedState = ReturnType<typeof useMainAppSharedState>;
