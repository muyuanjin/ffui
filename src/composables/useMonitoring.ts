import { ref, onMounted, onUnmounted } from "vue";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { fetchCpuUsage, fetchGpuUsage, hasTauri } from "@/lib/backend";

/**
 * 系统监控 Composable 配置选项
 */
export interface UseMonitoringOptions {
  /** 轮询间隔(毫秒),默认 2000ms */
  intervalMs?: number;
  /** 是否自动开始监控,默认 false */
  autoStart?: boolean;
}

/**
 * 系统监控 Composable
 *
 * @description 定期拉取 CPU/GPU 使用率数据
 * @param options - 配置选项
 * @returns 监控数据和控制方法
 *
 * @example
 * ```typescript
 * const { cpuSnapshot, gpuSnapshot, startMonitoring, stopMonitoring } = useMonitoring({
 *   intervalMs: 2000,
 *   autoStart: true
 * });
 * ```
 */
export function useMonitoring(options: UseMonitoringOptions = {}) {
  const { intervalMs = 2000, autoStart = false } = options;

  const cpuSnapshot = ref<CpuUsageSnapshot | null>(null);
  const gpuSnapshot = ref<GpuUsageSnapshot | null>(null);
  const isMonitoring = ref(false);
  let monitorTimer: number | undefined;

  const fetchMonitorData = async () => {
    if (!hasTauri()) return;

    try {
      const cpu = await fetchCpuUsage();
      if (cpu) cpuSnapshot.value = cpu;

      const gpu = await fetchGpuUsage();
      if (gpu) gpuSnapshot.value = gpu;
    } catch (e) {
      console.error("Failed to fetch monitor data:", e);
    }
  };

  const startMonitoring = () => {
    if (isMonitoring.value) return;

    isMonitoring.value = true;
    fetchMonitorData(); // 立即拉取一次

    monitorTimer = window.setInterval(() => {
      fetchMonitorData();
    }, intervalMs);
  };

  const stopMonitoring = () => {
    if (!isMonitoring.value) return;

    isMonitoring.value = false;
    if (monitorTimer !== undefined) {
      clearInterval(monitorTimer);
      monitorTimer = undefined;
    }
  };

  onMounted(() => {
    if (autoStart) {
      startMonitoring();
    }
  });

  onUnmounted(() => {
    stopMonitoring();
  });

  return {
    cpuSnapshot,
    gpuSnapshot,
    isMonitoring,
    startMonitoring,
    stopMonitoring,
    fetchMonitorData,
  };
}
