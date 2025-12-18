import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import type { JobCompareSources, TranscodeJob } from "@/types";
import {
  buildPreviewUrl,
  extractJobCompareConcatFrame,
  extractJobCompareFrame,
  hasTauri,
  loadPreviewDataUrl,
} from "@/lib/backend";
import { createScrubFrameScheduler } from "@/lib/scrubFrameScheduler";

export function useJobCompareFrames(options: {
  open: Ref<boolean>;
  job: Ref<TranscodeJob | null>;
  sources: Ref<JobCompareSources | null>;
  totalDurationSeconds: ComputedRef<number | null>;
  clampedTimelineSeconds: ComputedRef<number>;
  usingFrameCompare: ComputedRef<boolean>;
}) {
  const inputFramePath = ref<string | null>(null);
  const inputFrameUrl = ref<string | null>(null);
  const inputFrameError = ref<string | null>(null);
  const inputFrameLoading = ref(false);
  const inputFrameQuality = ref<"low" | "high" | null>(null);

  const outputFramePath = ref<string | null>(null);
  const outputFrameUrl = ref<string | null>(null);
  const outputFrameError = ref<string | null>(null);
  const outputFrameLoading = ref(false);
  const outputFrameQuality = ref<"low" | "high" | null>(null);

  const buildRequestKey = () => {
    const job = options.job.value;
    const s = options.sources.value;
    if (!options.open.value || !job || !s) return null;
    if (!hasTauri()) return null;
    if (!options.usingFrameCompare.value) return null;

    const rawSeconds = options.clampedTimelineSeconds.value;
    const safeSeconds = Number.isFinite(rawSeconds) && rawSeconds >= 0 ? rawSeconds : 0;
    const normalized = Math.round(safeSeconds * 1000) / 1000;
    return `${job.id}|${normalized.toFixed(3)}`;
  };

  const resetFrames = () => {
    scheduler.cancel();
    inputFramePath.value = null;
    inputFrameUrl.value = null;
    inputFrameError.value = null;
    inputFrameLoading.value = false;
    inputFrameQuality.value = null;
    outputFramePath.value = null;
    outputFrameUrl.value = null;
    outputFrameError.value = null;
    outputFrameLoading.value = false;
    outputFrameQuality.value = null;
  };

  const requestFrames = async (quality: "low" | "high", token: number) => {
    const job = options.job.value;
    const s = options.sources.value;
    if (!options.open.value || !job || !s) return;
    if (!hasTauri()) return;
    if (!options.usingFrameCompare.value) return;

    const positionSeconds = options.clampedTimelineSeconds.value;
    const inPath = s.inputPath;
    const out = s.output;

    inputFrameLoading.value = inputFrameUrl.value == null;
    outputFrameLoading.value = outputFrameUrl.value == null;
    if (quality === "high") {
      inputFrameError.value = null;
      outputFrameError.value = null;
    }

    try {
      try {
        const inputResult = await extractJobCompareFrame({
          jobId: job.id,
          sourcePath: inPath,
          positionSeconds,
          durationSeconds: options.totalDurationSeconds.value,
          quality,
        });

        if (!scheduler.isTokenCurrent(token)) return;

        inputFramePath.value = inputResult;
        inputFrameUrl.value = buildPreviewUrl(inputResult);
        inputFrameLoading.value = false;
        inputFrameQuality.value = quality;
      } catch (error) {
        if (!scheduler.isTokenCurrent(token)) return;
        inputFrameLoading.value = false;
        inputFrameError.value = (error as Error | undefined)?.message ?? String(error);
      }

      if (!scheduler.isTokenCurrent(token)) return;

      try {
        const outputResult = await (async () => {
          if (out.kind === "completed") {
            return extractJobCompareFrame({
              jobId: job.id,
              sourcePath: out.outputPath,
              positionSeconds,
              durationSeconds: options.totalDurationSeconds.value,
              quality,
            });
          }

          if (out.activeSegmentPath) {
            return extractJobCompareFrame({
              jobId: job.id,
              sourcePath: out.activeSegmentPath,
              positionSeconds,
              durationSeconds: options.totalDurationSeconds.value,
              quality,
            });
          }

          if (out.segmentPaths.length >= 2) {
            return extractJobCompareConcatFrame({
              jobId: job.id,
              segmentPaths: out.segmentPaths,
              positionSeconds,
              quality,
            });
          }

          const single = out.segmentPaths[0];
          if (!single) throw new Error("missing output segment");
          return extractJobCompareFrame({
            jobId: job.id,
            sourcePath: single,
            positionSeconds,
            durationSeconds: options.totalDurationSeconds.value,
            quality,
          });
        })();

        if (!scheduler.isTokenCurrent(token)) return;

        outputFramePath.value = outputResult;
        outputFrameUrl.value = buildPreviewUrl(outputResult);
        outputFrameLoading.value = false;
        outputFrameQuality.value = quality;
      } catch (error) {
        if (!scheduler.isTokenCurrent(token)) return;
        outputFrameLoading.value = false;
        outputFrameError.value = (error as Error | undefined)?.message ?? String(error);
      }
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      // Should be rare: `Promise.allSettled` handles per-side failures.
      inputFrameLoading.value = false;
      outputFrameLoading.value = false;
      inputFrameError.value = msg;
      outputFrameError.value = msg;
    }
  };

  const scheduler = createScrubFrameScheduler({
    lowDelayMs: 120,
    lowMode: "throttle",
    highDelayMs: 240,
    request: requestFrames,
  });

  const scheduleLowFrames = () => {
    const key = buildRequestKey();
    if (!key) return;
    scheduler.scheduleHighDebounced(key);
    scheduler.scheduleLow(key);
  };

  const requestHighFramesNow = () => {
    const key = buildRequestKey();
    if (!key) return;
    scheduler.clearTimers();
    scheduler.requestHighNow(key);
  };

  const shouldRequest = computed(() => {
    return options.open.value && options.usingFrameCompare.value && !!options.sources.value?.jobId;
  });

  watch(
    () => [shouldRequest.value, options.clampedTimelineSeconds.value] as const,
    ([enabled]) => {
      if (!enabled) return;
      scheduleLowFrames();
    },
    // Frame requests should respond immediately to scrubbing; keeping this
    // synchronous also makes timer-driven upgrades deterministic in tests.
    { immediate: true, flush: "sync" },
  );

  const handleFrameImgError = async (side: "input" | "output") => {
    const path = side === "input" ? inputFramePath.value : outputFramePath.value;
    if (!path) return;
    if (!hasTauri()) return;

    try {
      const url = await loadPreviewDataUrl(path);
      if (side === "input") inputFrameUrl.value = url;
      else outputFrameUrl.value = url;
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      if (side === "input") inputFrameError.value = msg;
      else outputFrameError.value = msg;
    }
  };

  onBeforeUnmount(() => {
    scheduler.cancel();
  });

  return {
    inputFrameUrl,
    inputFrameLoading,
    inputFrameError,
    inputFrameQuality,
    outputFrameUrl,
    outputFrameLoading,
    outputFrameError,
    outputFrameQuality,
    clearFrameTimers: scheduler.cancel,
    resetFrames,
    requestHighFramesNow,
    handleFrameImgError,
  };
}
