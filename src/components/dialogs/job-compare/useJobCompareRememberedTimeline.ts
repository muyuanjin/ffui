import type { Ref } from "vue";
import type { TranscodeJob } from "@/types";

const normalizeInputKey = (raw: string | null | undefined): string | null => {
  const trimmed = String(raw ?? "").trim();
  return trimmed ? trimmed : null;
};

export function useJobCompareRememberedTimeline(options: {
  inputPath: Ref<string | null>;
  job: Ref<TranscodeJob | null>;
  timeline: Ref<number[]>;
  clampedTimelineSeconds: Ref<number>;
}) {
  // Remember last compare position per input path so users can run multiple output
  // experiments against the same input without re-scrubbing every time.
  const lastTimelineByInput = new Map<string, number>();

  const getActiveInputKey = (): string | null => {
    return (
      normalizeInputKey(options.inputPath.value) ??
      normalizeInputKey(options.job.value?.inputPath) ??
      normalizeInputKey(options.job.value?.filename) ??
      null
    );
  };

  const rememberTimelineForActiveInput = () => {
    const key = getActiveInputKey();
    if (!key) return;
    const seconds = options.clampedTimelineSeconds.value;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    lastTimelineByInput.set(key, seconds);
  };

  const restoreTimelineForActiveInput = () => {
    const key = getActiveInputKey();
    if (!key) {
      options.timeline.value = [0];
      return;
    }
    const remembered = lastTimelineByInput.get(key);
    options.timeline.value = [
      typeof remembered === "number" && Number.isFinite(remembered) && remembered >= 0 ? remembered : 0,
    ];
  };

  return {
    rememberTimelineForActiveInput,
    restoreTimelineForActiveInput,
  };
}
