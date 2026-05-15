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
      phaseUpdatedAtMs?: number;
    };
    if (value?.status !== "processing") return false;
    return typeof (value.processingStartedMs ?? value.startTime ?? value.phaseUpdatedAtMs) === "number";
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
  const phaseEtaMs = computed(() => {
    if (job.value.status !== "processing") return null;
    const updatedAt = job.value.phaseUpdatedAtMs;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;

    const now = needsTick.value ? sharedNowMs.value : Date.now();
    const elapsedSinceSampleMs = Math.max(0, now - updatedAt);

    const backendEta = job.value.phaseEtaMs;
    if (typeof backendEta === "number" && Number.isFinite(backendEta) && backendEta >= 0) {
      return Math.max(0, backendEta - elapsedSinceSampleMs);
    }

    const duration = job.value.phaseDurationSeconds;
    const outTime = job.value.phaseOutTimeSeconds;
    const speed = job.value.phaseSpeed;
    if (
      typeof duration === "number" &&
      Number.isFinite(duration) &&
      duration > 0 &&
      typeof outTime === "number" &&
      Number.isFinite(outTime) &&
      outTime >= 0 &&
      typeof speed === "number" &&
      Number.isFinite(speed) &&
      speed > 0
    ) {
      const estimatedOutTime = outTime + (elapsedSinceSampleMs / 1000) * speed;
      return Math.max(0, ((duration - estimatedOutTime) / speed) * 1000);
    }

    return null;
  });

  const estimatedRemainingMs = computed(() => {
    if (phaseEtaMs.value != null) return phaseEtaMs.value;
    if (job.value.progressPhase && job.value.status === "processing") return null;
    return estimateRemainingTime(elapsedMs.value, progressForEstimates.value);
  });

  // 格式化的预估剩余时间
  const estimatedRemainingTimeDisplay = computed(() => {
    if (estimatedRemainingMs.value === 0) return "0:00";
    return formatElapsedTime(estimatedRemainingMs.value);
  });

  const isRemainingTimeCalculating = computed(() => {
    return job.value.status === "processing" && estimatedRemainingMs.value == null;
  });

  const phaseDisplayKey = computed(() => {
    const phase = job.value.progressPhase;
    return phase ? `queue.progressPhase.${phase}` : null;
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
    isRemainingTimeCalculating,
    phaseDisplayKey,
    shouldShowTimeInfo,
    isTerminalState,
    isProcessing,
  };
}
