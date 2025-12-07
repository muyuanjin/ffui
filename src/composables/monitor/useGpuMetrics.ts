/**
 * GPU 指标管理
 *
 * 管理 GPU 使用率和显存历史数据，提供平滑后的时间序列数据
 */

import { computed } from "vue";
import type { GpuUsageSnapshot, SystemMetricsSnapshot } from "@/types";
import { smoothEma } from "./useChartDataBuffer";

const MAX_HISTORY_POINTS = 60;

/**
 * GPU 指标 Composable
 *
 * @param snapshots - 系统指标快照的响应式引用
 * @returns GPU 相关的计算属性
 */
export function useGpuMetrics(snapshots: { value: SystemMetricsSnapshot[] }) {
  // GPU 指标：优先从 system-metrics 流获取，以避免通过轮询命令获取 GPU 使用率。
  const latestGpu = computed<GpuUsageSnapshot | null>(() => {
    const last = snapshots.value[snapshots.value.length - 1];
    if (last && last.gpu) return last.gpu;
    return null;
  });

  const gpuHistory = computed<
    Array<{ timestamp: number; usage: number; memory: number }>
  >(() => {
    const points: Array<{ timestamp: number; usage: number; memory: number }> = [];
    for (const s of snapshots.value) {
      const gpu = s.gpu;
      if (!gpu || !gpu.available) continue;
      const usage = gpu.gpuPercent ?? 0;
      const memory = gpu.memoryPercent ?? 0;
      points.push({ timestamp: s.timestamp, usage, memory });
    }
    if (points.length <= MAX_HISTORY_POINTS) return points;
    return points.slice(points.length - MAX_HISTORY_POINTS);
  });

  // GPU 曲线做一次轻度平滑，减少闪烁
  const gpuUsageSeries = computed(() =>
    smoothEma(gpuHistory.value.map((p) => p.usage)),
  );

  const gpuMemorySeries = computed(() =>
    smoothEma(gpuHistory.value.map((p) => p.memory)),
  );

  return {
    latestGpu,
    gpuHistory,
    gpuUsageSeries,
    gpuMemorySeries,
  };
}
