import { onBeforeUnmount, ref, type Ref } from "vue";

export function useJobCompareOutOfRangeHint(options: {
  compareIncomplete: Ref<boolean>;
  timelineWrapEl: Ref<HTMLElement | null>;
  timelineMaxSeconds: Ref<number>;
  maxCompareSeconds: Ref<number>;
}) {
  const outOfRangeHintVisible = ref(false);
  const outOfRangeHintTimerId = ref<number | null>(null);

  const showOutOfRangeHint = () => {
    outOfRangeHintVisible.value = true;
    if (outOfRangeHintTimerId.value != null) {
      window.clearTimeout(outOfRangeHintTimerId.value);
    }
    outOfRangeHintTimerId.value = window.setTimeout(() => {
      outOfRangeHintVisible.value = false;
      outOfRangeHintTimerId.value = null;
    }, 1600);
  };

  const isOutOfRangeSeconds = (seconds: number) => {
    if (!options.compareIncomplete.value) return false;
    return seconds > options.maxCompareSeconds.value + 1e-6;
  };

  const allowTimelineSecondsOrHint = (seconds: number) => {
    if (isOutOfRangeSeconds(seconds)) {
      showOutOfRangeHint();
      return false;
    }
    return true;
  };

  const handleTimelinePointerDownCapture = (event: PointerEvent) => {
    if (!options.compareIncomplete.value) return;
    if (event.button !== 0) return;
    const el = options.timelineWrapEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    if (!Number.isFinite(w) || w <= 0) return;
    const x = event.clientX - rect.left;
    if (!Number.isFinite(x) || x < 0 || x > w) return;
    const seconds = (x / w) * options.timelineMaxSeconds.value;
    if (Number.isFinite(seconds) && isOutOfRangeSeconds(seconds)) {
      event.preventDefault();
      event.stopPropagation();
      showOutOfRangeHint();
    }
  };

  onBeforeUnmount(() => {
    if (outOfRangeHintTimerId.value != null) {
      window.clearTimeout(outOfRangeHintTimerId.value);
      outOfRangeHintTimerId.value = null;
    }
  });

  return {
    outOfRangeHintVisible,
    allowTimelineSecondsOrHint,
    handleTimelinePointerDownCapture,
  };
}
