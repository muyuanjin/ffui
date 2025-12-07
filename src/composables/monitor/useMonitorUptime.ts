/**
 * 监控面板在线时长
 *
 * 计算监控面板自启动以来的运行时间和进度百分比
 */

import { computed } from "vue";
import type { SystemMetricsSnapshot } from "@/types";

/**
 * 监控在线时长 Composable
 *
 * @param snapshots - 系统指标快照的响应式引用
 * @returns 在线时长相关的计算属性
 */
export function useMonitorUptime(snapshots: { value: SystemMetricsSnapshot[] }) {
  // 监控面板自身的"大致在线时长"，用于替换随机的 SYSTEM UPTIME 数字。
  const monitorUptime = computed(() => {
    if (snapshots.value.length < 2) return null;
    const first = snapshots.value[0].timestamp;
    const last = snapshots.value[snapshots.value.length - 1].timestamp;
    const totalSeconds = Math.max(0, Math.round((last - first) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const remMinutes = minutes % 60;
    return { days, hours: remHours, minutes: remMinutes, totalSeconds };
  });

  const monitorUptimeProgressPercent = computed(() => {
    const uptime = monitorUptime.value;
    if (!uptime) return 0;
    // 映射到一个 0-10 分钟的进度条区间，避免进度条过快或过慢。
    const maxSeconds = 10 * 60;
    return Math.min(100, (uptime.totalSeconds / maxSeconds) * 100);
  });

  return {
    monitorUptime,
    monitorUptimeProgressPercent,
  };
}
