import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import type { JobCompareSources, TranscodeJob } from "@/types";
import {
  buildPreviewUrl,
  extractJobCompareConcatFrame,
  extractJobCompareFrame,
  hasTauri,
  loadPreviewDataUrl,
} from "@/lib/backend";

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

  const requestToken = ref(0);
  const lowTimer = ref<number | null>(null);
  const highTimer = ref<number | null>(null);
  const lastLowRequestAtMs = ref(0);

  const clearTimers = () => {
    if (lowTimer.value != null) {
      window.clearTimeout(lowTimer.value);
      lowTimer.value = null;
    }
    if (highTimer.value != null) {
      window.clearTimeout(highTimer.value);
      highTimer.value = null;
    }
  };

  const resetFrames = () => {
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
    lastLowRequestAtMs.value = 0;
  };

  const requestFrames = async (quality: "low" | "high") => {
    const job = options.job.value;
    const s = options.sources.value;
    if (!options.open.value || !job || !s) return;
    if (!hasTauri()) return;
    if (!options.usingFrameCompare.value) return;

    const token = ++requestToken.value;
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
      const inputPromise = extractJobCompareFrame({
        jobId: job.id,
        sourcePath: inPath,
        positionSeconds,
        durationSeconds: options.totalDurationSeconds.value,
        quality,
      });

      const outputPromise = (async () => {
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

      const [inputPathResult, outputPathResult] = await Promise.all([inputPromise, outputPromise]);
      if (token !== requestToken.value) return;

      inputFramePath.value = inputPathResult;
      inputFrameUrl.value = buildPreviewUrl(inputPathResult);
      inputFrameLoading.value = false;
      inputFrameQuality.value = quality;

      outputFramePath.value = outputPathResult;
      outputFrameUrl.value = buildPreviewUrl(outputPathResult);
      outputFrameLoading.value = false;
      outputFrameQuality.value = quality;
    } catch (error) {
      if (token !== requestToken.value) return;
      const msg = (error as Error)?.message ?? String(error);
      inputFrameLoading.value = false;
      outputFrameLoading.value = false;
      inputFrameError.value = msg;
      outputFrameError.value = msg;
    }
  };

  const scheduleLowFrames = () => {
    const lowThrottleMs = 120;
    const highDebounceMs = 240;

    if (highTimer.value != null) {
      window.clearTimeout(highTimer.value);
      highTimer.value = null;
    }
    highTimer.value = window.setTimeout(() => void requestFrames("high"), highDebounceMs);

    if (lowTimer.value != null) return;

    const now = Date.now();
    const elapsed = now - lastLowRequestAtMs.value;
    const delay = elapsed >= lowThrottleMs ? 0 : lowThrottleMs - elapsed;
    lowTimer.value = window.setTimeout(() => {
      lowTimer.value = null;
      lastLowRequestAtMs.value = Date.now();
      void requestFrames("low");
    }, delay);
  };

  const shouldRequest = computed(() => {
    return (
      options.open.value &&
      options.usingFrameCompare.value &&
      !!options.sources.value?.jobId
    );
  });

  watch(
    () => [shouldRequest.value, options.clampedTimelineSeconds.value] as const,
    ([enabled]) => {
      if (!enabled) return;
      scheduleLowFrames();
    },
    { immediate: true },
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
    clearTimers();
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
    clearFrameTimers: clearTimers,
    resetFrames,
    handleFrameImgError,
  };
}
