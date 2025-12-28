import { computed, inject, provide, type ComputedRef, type Ref } from "vue";

export interface QueuePerfHints {
  /** True while the user is actively scrolling/wheeling inside the queue panel. */
  isScrolling: Ref<boolean>;
  /** True when at least one job is currently processing. */
  isQueueRunning: ComputedRef<boolean>;
  /** True when expensive UI effects (FLIP, heavy progress styles) are allowed. */
  allowHeavyEffects: ComputedRef<boolean>;
  /** True when it's OK to auto-trigger preview generation. */
  allowPreviewAutoEnsure: ComputedRef<boolean>;
  /** True when it's OK to start new preview image loads/decodes. */
  allowPreviewLoads: ComputedRef<boolean>;
}

const QUEUE_PERF_HINTS_KEY: unique symbol = Symbol("ffui.queue.perfHints");

export function provideQueuePerfHints(hints: { isScrolling: Ref<boolean>; isQueueRunning: ComputedRef<boolean> }) {
  const allowHeavyEffects = computed(() => !hints.isScrolling.value && !hints.isQueueRunning.value);
  const allowPreviewAutoEnsure = computed(() => !hints.isScrolling.value);
  const allowPreviewLoads = computed(() => !hints.isScrolling.value);

  provide(QUEUE_PERF_HINTS_KEY, {
    isScrolling: hints.isScrolling,
    isQueueRunning: hints.isQueueRunning,
    allowHeavyEffects,
    allowPreviewAutoEnsure,
    allowPreviewLoads,
  } satisfies QueuePerfHints);
}

export function useQueuePerfHints(): QueuePerfHints | null {
  return inject<QueuePerfHints | null>(QUEUE_PERF_HINTS_KEY, null);
}
