/**
 * 时间格式化工具函数
 */

/**
 * 将毫秒格式化为人类可读的时间字符串
 * @param ms 毫秒数
 * @returns 格式化的时间字符串，如 "1:23:45" 或 "12:34"
 */
export function formatElapsedTime(ms: number | null | undefined): string {
  if (ms == null || ms <= 0 || !Number.isFinite(ms)) return "-";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 根据当前进度和已用时间计算预估总时间
 * @param elapsedMs 已用时间（毫秒）
 * @param progress 当前进度（0-100）
 * @returns 预估总时间（毫秒），如果无法计算则返回 null
 */
export function estimateTotalTime(
  elapsedMs: number | null | undefined,
  progress: number | null | undefined,
): number | null {
  if (
    elapsedMs == null ||
    elapsedMs <= 0 ||
    !Number.isFinite(elapsedMs) ||
    progress == null ||
    progress <= 0 ||
    progress >= 100 ||
    !Number.isFinite(progress)
  ) {
    return null;
  }

  // 预估总时间 = 已用时间 / (进度 / 100)
  const estimated = elapsedMs / (progress / 100);
  return Number.isFinite(estimated) ? estimated : null;
}

/**
 * 根据当前进度和已用时间计算预估剩余时间
 * @param elapsedMs 已用时间（毫秒）
 * @param progress 当前进度（0-100）
 * @returns 预估剩余时间（毫秒），如果无法计算则返回 null
 */
export function estimateRemainingTime(
  elapsedMs: number | null | undefined,
  progress: number | null | undefined,
): number | null {
  const totalMs = estimateTotalTime(elapsedMs, progress);
  if (totalMs == null || elapsedMs == null) return null;

  const remaining = totalMs - elapsedMs;
  return remaining > 0 ? remaining : null;
}

/**
 * 计算任务的实时已用时间（毫秒）
 * 对于正在处理的任务，基于 startTime 和当前时间计算
 * 对于已完成/暂停的任务，使用 elapsedMs 或基于 startTime/endTime 计算
 * @param job 任务对象
 * @param nowMs 当前时间戳（毫秒），用于实时计算
 * @returns 已用时间（毫秒）
 */
export function computeJobElapsedMs(
  job: {
    status: string;
    startTime?: number;
    endTime?: number;
    processingStartedMs?: number;
    elapsedMs?: number;
  },
  nowMs: number,
): number | null {
  // 对于已完成的任务，优先使用 elapsedMs，否则基于 startTime/endTime 计算
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "skipped") {
    if (job.elapsedMs != null && job.elapsedMs > 0) {
      return job.elapsedMs;
    }
    const fallbackStart = job.processingStartedMs ?? job.startTime;
    if (fallbackStart != null && job.endTime != null && job.endTime > fallbackStart) {
      return job.endTime - fallbackStart;
    }
    return null;
  }

  // 对于暂停的任务，使用 elapsedMs
  if (job.status === "paused") {
    return job.elapsedMs ?? null;
  }

  // 对于正在处理的任务，使用后端提供的 elapsedMs（已包含暂停累计时间）
  // 如果没有 elapsedMs，则基于 startTime 计算
  if (job.status === "processing") {
    if (job.elapsedMs != null && job.elapsedMs > 0) {
      return job.elapsedMs;
    }
    const fallbackStart = job.processingStartedMs ?? job.startTime;
    if (fallbackStart != null && nowMs > fallbackStart) {
      return nowMs - fallbackStart;
    }
  }

  return null;
}
