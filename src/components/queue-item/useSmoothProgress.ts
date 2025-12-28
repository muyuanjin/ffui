import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import type { QueueProgressStyle, TranscodeJob } from "@/types";
import { clampProgressUpdateIntervalMs } from "@/lib/progressTransition";

interface UseSmoothProgressOptions {
  job: ComputedRef<TranscodeJob>;
  progressStyle: ComputedRef<QueueProgressStyle | undefined>;
  progressUpdateIntervalMs?: ComputedRef<number | undefined>;
}

export function useSmoothProgress(options: UseSmoothProgressOptions) {
  const isSkipped = computed(() => options.job.value.status === "skipped");

  const effectiveProgressStyle = computed<QueueProgressStyle>(() => options.progressStyle.value ?? "bar");

  const clampedProgress = computed<number>(() => {
    const status = options.job.value.status;
    const progress = options.job.value.progress;

    if (status === "completed" || status === "failed" || status === "skipped" || status === "cancelled") {
      return 100;
    }

    if (status === "processing" || status === "paused") {
      const raw = typeof progress === "number" ? progress : 0;
      return Math.max(0, Math.min(100, raw));
    }

    return 0; // queued
  });

  const effectiveProgressIntervalMs = computed(() => {
    return clampProgressUpdateIntervalMs(options.progressUpdateIntervalMs?.value);
  });

  const smoothTickMs = computed(() => {
    // Keep the progress indicator advancing smoothly without overwhelming the UI.
    // The update interval is "backend cadence"; we tick faster than that but stay bounded.
    const interval = effectiveProgressIntervalMs.value;
    return Math.max(50, Math.min(200, Math.floor(interval / 2)));
  });

  const estimateProgressPercentNow = (nowMs: number, allowDecrease: boolean): number => {
    const job = options.job.value;
    if (job.status !== "processing") return clampedProgress.value;

    const durationSeconds = job.mediaInfo?.durationSeconds;
    const meta = job.waitMetadata;
    const baseOutTimeSeconds = meta?.lastProgressOutTimeSeconds;
    const lastUpdatedAtMs = meta?.lastProgressUpdatedAtMs;

    if (
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      typeof baseOutTimeSeconds !== "number" ||
      !Number.isFinite(baseOutTimeSeconds) ||
      baseOutTimeSeconds < 0 ||
      typeof lastUpdatedAtMs !== "number" ||
      !Number.isFinite(lastUpdatedAtMs) ||
      lastUpdatedAtMs < 0
    ) {
      // Fall back to the backend-provided percentage when telemetry is missing.
      return clampedProgress.value;
    }

    const speed = (() => {
      const v = meta?.lastProgressSpeed;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      // Avoid extrapolating without an explicit speed sample.
      return 0;
    })();

    const elapsedWallMs = Math.max(0, nowMs - lastUpdatedAtMs);
    const staleThresholdMs = Math.max(1500, effectiveProgressIntervalMs.value * 3);
    const shouldFreeze = elapsedWallMs > staleThresholdMs;
    const maxExtrapolateMs = Math.min(elapsedWallMs, Math.min(5000, staleThresholdMs));
    const elapsedWallSeconds = shouldFreeze ? 0 : Math.max(0, maxExtrapolateMs / 1000);
    const estimatedOutTimeSeconds = baseOutTimeSeconds + elapsedWallSeconds * speed;
    const estimatedPercent = Math.max(0, Math.min(100, (estimatedOutTimeSeconds / durationSeconds) * 100));
    const backendPercent = clampedProgress.value;

    const capWhileProcessing = (value: number): number => {
      // The backend intentionally avoids emitting 100% while still processing.
      // Keep that behavior for estimates, but never override an explicit 100%
      // already provided by the backend (tests and edge cases rely on clamping).
      if (backendPercent >= 100) return 100;
      return Math.min(99.9, value);
    };

    const cappedBackend = capWhileProcessing(backendPercent);
    const cappedEstimate = capWhileProcessing(estimatedPercent);

    if (allowDecrease) {
      // New epoch: accept true rollbacks (e.g. crash recovery overlap) by
      // trusting telemetry rather than forcing monotonic progress.
      return cappedEstimate;
    }

    // Same epoch: never drift backward.
    return Math.max(cappedBackend, cappedEstimate);
  };

  const displayedProgress = ref<number>(clampedProgress.value);
  let smoothTimer: ReturnType<typeof setInterval> | null = null;
  let smoothStartToken = 0;
  let lastSmoothTickAtMs: number | null = null;
  let lastEpochSeen: number | null = null;

  const stopSmoothing = () => {
    if (smoothTimer != null) {
      clearInterval(smoothTimer);
      smoothTimer = null;
    }
    lastSmoothTickAtMs = null;
  };

  const resolveProgressEpoch = (): number | null => {
    const epoch = options.job.value.waitMetadata?.progressEpoch;
    if (typeof epoch === "number" && Number.isFinite(epoch) && epoch >= 0) return Math.floor(epoch);
    return null;
  };

  const computeMaxDeltaPercent = (dtSeconds: number, current: number, target: number): number => {
    if (dtSeconds <= 0) return 0;

    const diff = target - current;
    const absDiff = Math.abs(diff);
    if (!Number.isFinite(absDiff) || absDiff <= 0) return 0;

    const job = options.job.value;
    const durationSeconds = job.mediaInfo?.durationSeconds;
    const speed = job.waitMetadata?.lastProgressSpeed;
    const realRatePercentPerSecond =
      typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0 &&
      typeof speed === "number" &&
      Number.isFinite(speed) &&
      speed > 0
        ? (speed / durationSeconds) * 100
        : 0;

    // Catch up quickly but never teleport.
    const catchUpSeconds = 0.85;
    const desiredRate = absDiff / catchUpSeconds;
    const maxRatePercentPerSecond = 60;
    const minCatchUpRatePercentPerSecond = 3;
    const rate = Math.min(
      maxRatePercentPerSecond,
      Math.max(realRatePercentPerSecond, desiredRate, minCatchUpRatePercentPerSecond),
    );
    const maxDelta = rate * dtSeconds;
    return Number.isFinite(maxDelta) ? maxDelta : 0;
  };

  const startSmoothing = () => {
    stopSmoothing();

    const tick = () => {
      const nowMs = Date.now();
      const previousTickAtMs = lastSmoothTickAtMs;
      const dtMs = previousTickAtMs == null ? smoothTickMs.value : Math.max(0, nowMs - previousTickAtMs);
      lastSmoothTickAtMs = nowMs;

      const epoch = resolveProgressEpoch();
      const isNewEpoch = lastEpochSeen != null && epoch != null && epoch !== lastEpochSeen;
      if (epoch != null && (lastEpochSeen == null || isNewEpoch)) {
        lastEpochSeen = epoch;
      }

      const target = estimateProgressPercentNow(nowMs, isNewEpoch);
      const current = displayedProgress.value;
      if (!Number.isFinite(current)) {
        displayedProgress.value = target;
        return;
      }

      const dtSeconds = dtMs / 1000;
      const maxDelta = computeMaxDeltaPercent(dtSeconds, current, target);
      const diff = target - current;
      if (Math.abs(diff) <= 0.1) {
        displayedProgress.value = target;
        return;
      }
      if (Math.abs(diff) <= maxDelta) {
        displayedProgress.value = target;
        return;
      }
      displayedProgress.value = current + Math.sign(diff) * maxDelta;
    };
    tick();
    smoothTimer = setInterval(tick, smoothTickMs.value);
  };

  onScopeDispose(() => stopSmoothing());

  watch(
    () => options.job.value.status,
    (next, prev) => {
      stopSmoothing();
      smoothStartToken += 1;
      const token = smoothStartToken;

      if (next === "processing") {
        const meta = options.job.value.waitMetadata;
        const hasResumeEvidence =
          meta != null &&
          ((typeof meta.lastProgressPercent === "number" &&
            Number.isFinite(meta.lastProgressPercent) &&
            meta.lastProgressPercent > 0) ||
            (typeof meta.processedSeconds === "number" &&
              Number.isFinite(meta.processedSeconds) &&
              meta.processedSeconds > 0) ||
            (typeof meta.processedWallMillis === "number" &&
              Number.isFinite(meta.processedWallMillis) &&
              meta.processedWallMillis > 0) ||
            (typeof meta.tmpOutputPath === "string" && meta.tmpOutputPath.trim() !== ""));

        // Avoid "teleporting" on fresh queued -> processing starts: ensure the
        // progress layer mounts at 0, then animate toward the latest estimate.
        //
        // For resume flows (paused -> queued -> processing), keep continuity by
        // starting from the best-known baseline instead of resetting to 0.
        if (prev === "queued" && !hasResumeEvidence) {
          displayedProgress.value = 0;
          const schedule = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
          if (schedule) {
            window.requestAnimationFrame(() => {
              if (token !== smoothStartToken) return;
              if (options.job.value.status !== "processing") return;
              startSmoothing();
            });
          } else {
            setTimeout(() => {
              if (token !== smoothStartToken) return;
              if (options.job.value.status !== "processing") return;
              startSmoothing();
            }, 0);
          }
          return;
        }

        if (prev === "queued" && hasResumeEvidence) {
          const baseline = estimateProgressPercentNow(Date.now(), false);
          displayedProgress.value = Math.max(0, Math.min(100, baseline));
        }

        startSmoothing();
        return;
      }

      // Non-processing states: follow the backend value and stop ticking.
      displayedProgress.value = clampedProgress.value;
    },
    { immediate: true, flush: "sync" },
  );

  watch(
    () => clampedProgress.value,
    (next) => {
      const status = options.job.value.status;
      if (status !== "processing") {
        displayedProgress.value = next;
      }
    },
    { flush: "sync" },
  );

  const progressTransitionMs = computed<number>(() => {
    const status = options.job.value.status;
    if (status === "queued") return 0;
    if (status === "completed" || status === "failed" || status === "cancelled" || status === "skipped") return 180;

    // Prefer the smoother tick cadence over the raw backend interval so the
    // indicator stays fluid even when the backend reports in bursts.
    return Math.max(80, Math.min(220, Math.floor(Math.max(smoothTickMs.value, 50) * 1.2)));
  });

  const showBarProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "bar",
  );

  const showCardFillProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "card-fill",
  );

  const showRippleCardProgress = computed(
    () => !isSkipped.value && options.job.value.status !== "queued" && effectiveProgressStyle.value === "ripple-card",
  );

  return {
    isSkipped,
    displayedClampedProgress: computed(() => Math.max(0, Math.min(100, displayedProgress.value))),
    progressTransitionMs,
    showBarProgress,
    showCardFillProgress,
    showRippleCardProgress,
  };
}
