import { computed, onMounted, onUnmounted, watch, ref, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { formatElapsedTime, estimateTotalTime, estimateRemainingTime, computeJobElapsedMs } from "@/lib/timeUtils";

const sharedNowMs = ref(Date.now());
let sharedIntervalId: ReturnType<typeof setInterval> | null = null;
let sharedSubscribers = 0;

const startSharedTicker = () => {
  if (sharedIntervalId != null) return;
  sharedNowMs.value = Date.now();
  sharedIntervalId = setInterval(() => {
    sharedNowMs.value = Date.now();
  }, 1000);
};

const stopSharedTickerIfIdle = () => {
  if (sharedSubscribers > 0) return;
  if (sharedIntervalId == null) return;
  clearInterval(sharedIntervalId);
  sharedIntervalId = null;
};

/**
 * 用于显示任务时间信息的组合式函数
 * 提供实时更新的已用时间、预估总时间和预估剩余时间
 */
export function useJobTimeDisplay(job: Ref<TranscodeJob>) {
  const needsTick = computed(() => {
    const value = job.value as unknown as {
      status?: string;
      startTime?: number;
      processingStartedMs?: number;
    };
    if (value?.status !== "processing") return false;
    return typeof (value.processingStartedMs ?? value.startTime) === "number";
  });

  const sampledProgress = ref<number | null>(null);
  const sampleProgressNow = () => {
    const p = job.value.progress;
    if (typeof p !== "number" || !Number.isFinite(p)) {
      sampledProgress.value = null;
      return;
    }
    sampledProgress.value = p;
  };

  let subscribed = false;
  const syncSubscription = (next: boolean) => {
    if (next && !subscribed) {
      subscribed = true;
      sharedSubscribers += 1;
      startSharedTicker();
      return;
    }
    if (!next && subscribed) {
      subscribed = false;
      sharedSubscribers = Math.max(0, sharedSubscribers - 1);
      stopSharedTickerIfIdle();
    }
  };

  onMounted(() => {
    syncSubscription(needsTick.value);
    if (needsTick.value) {
      sampleProgressNow();
    } else {
      sampledProgress.value = null;
    }
  });

  watch(
    needsTick,
    (next) => {
      syncSubscription(next);
      if (next) {
        sampleProgressNow();
      } else {
        sampledProgress.value = null;
      }
    },
    { flush: "sync" },
  );

  onUnmounted(() => {
    if (subscribed) {
      subscribed = false;
      sharedSubscribers = Math.max(0, sharedSubscribers - 1);
      stopSharedTickerIfIdle();
    }
  });

  // 计算已用时间（毫秒）
  const elapsedMs = computed(() => {
    const now = needsTick.value ? sharedNowMs.value : 0;
    return computeJobElapsedMs(job.value, now);
  });

  const progressForEstimates = computed(() => {
    if (!needsTick.value) return job.value.progress;
    return sampledProgress.value ?? job.value.progress;
  });

  watch(
    sharedNowMs,
    () => {
      if (!needsTick.value) return;
      sampleProgressNow();
    },
    { flush: "sync" },
  );

  // 格式化的已用时间
  const elapsedTimeDisplay = computed(() => {
    return formatElapsedTime(elapsedMs.value);
  });

  // 预估总时间（毫秒）
  const estimatedTotalMs = computed(() => {
    return estimateTotalTime(elapsedMs.value, progressForEstimates.value);
  });

  // 格式化的预估总时间
  const estimatedTotalTimeDisplay = computed(() => {
    return formatElapsedTime(estimatedTotalMs.value);
  });

  // 预估剩余时间（毫秒）
  const estimatedRemainingMs = computed(() => {
    return estimateRemainingTime(elapsedMs.value, progressForEstimates.value);
  });

  // 格式化的预估剩余时间
  const estimatedRemainingTimeDisplay = computed(() => {
    return formatElapsedTime(estimatedRemainingMs.value);
  });

  // 是否应该显示时间信息
  const shouldShowTimeInfo = computed(() => {
    const status = job.value.status;
    // 对于正在处理、暂停、已完成、失败的任务显示时间信息
    return (
      status === "processing" ||
      status === "paused" ||
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    );
  });

  // 是否是终态（已完成/失败/取消/跳过）
  const isTerminalState = computed(() => {
    const status = job.value.status;
    return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
  });

  // 是否正在处理
  const isProcessing = computed(() => {
    return job.value.status === "processing";
  });

  return {
    elapsedMs,
    elapsedTimeDisplay,
    estimatedTotalMs,
    estimatedTotalTimeDisplay,
    estimatedRemainingMs,
    estimatedRemainingTimeDisplay,
    shouldShowTimeInfo,
    isTerminalState,
    isProcessing,
  };
}
