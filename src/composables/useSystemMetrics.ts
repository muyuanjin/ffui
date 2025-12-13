import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  type ComputedRef,
  type Ref,
} from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  hasTauri,
  metricsSubscribe,
  metricsUnsubscribe,
  fetchMetricsHistory,
} from "@/lib/backend";
import type { SystemMetricsSnapshot } from "@/types";

export interface UseSystemMetricsOptions {
  /** Maximum number of snapshots kept in memory for charting. */
  historyLimit?: number;
  /** Interval for mock metrics in web-only mode (ms). */
  mockIntervalMs?: number;
  /**
   * Minimum interval between UI updates (ms).
   * When set to 0 or omitted, the composable will forward every
   * incoming `system-metrics://update` 事件到前端历史，不再做额外节流。
   * 在极端高频采样场景下可以显式设置一个较大的值来保护 UI。
   */
  viewUpdateMinIntervalMs?: number;
}

export interface TimePoint {
  timestamp: number;
  value: number;
}

export interface CoreSeries {
  coreIndex: number;
  values: TimePoint[];
}

export interface MemoryPoint {
  timestamp: number;
  usedBytes: number;
  totalBytes: number;
}

export interface DiskPoint {
  timestamp: number;
  readBps: number;
  writeBps: number;
}

export interface NetworkSeries {
  name: string;
  values: {
    timestamp: number;
    rxBps: number;
    txBps: number;
  }[];
}

export interface UseSystemMetricsReturn {
  snapshots: Readonly<Ref<SystemMetricsSnapshot[]>>;
  cpuTotalSeries: Readonly<ComputedRef<TimePoint[]>>;
  perCoreSeries: Readonly<ComputedRef<CoreSeries[]>>;
  memorySeries: Readonly<ComputedRef<MemoryPoint[]>>;
  diskSeries: Readonly<ComputedRef<DiskPoint[]>>;
  networkSeries: Readonly<ComputedRef<NetworkSeries[]>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const METRICS_EVENT_NAME = "system-metrics://update";
const MAX_CORES_FOR_CHART = 32;

export function useSystemMetrics(
  options: UseSystemMetricsOptions = {},
): UseSystemMetricsReturn {
  const historyLimit = options.historyLimit ?? 600;
  const mockIntervalMs = options.mockIntervalMs ?? 1000;
  const viewUpdateMinIntervalMs = options.viewUpdateMinIntervalMs ?? 0;

  const snapshots = ref<SystemMetricsSnapshot[]>([]);
  const isActive = ref(false);

  let metricsUnlisten: UnlistenFn | null = null;
  let mockTimer: number | null = null;
  let mockBootAtMs: number | null = null;
  let lastPushedAt = 0;

  const pushSnapshot = (snapshot: SystemMetricsSnapshot) => {
    const arr = snapshots.value;
    arr.push(snapshot);
    if (arr.length > historyLimit) {
      arr.splice(0, arr.length - historyLimit);
    }
  };

  const startMockStream = () => {
    if (typeof window === "undefined") return;
    if (mockTimer !== null) return;
    if (mockBootAtMs === null) {
      mockBootAtMs = Date.now();
    }

    mockTimer = window.setInterval(() => {
      const now = Date.now();
      const uptimeSeconds = Math.max(0, Math.floor((now - (mockBootAtMs ?? now)) / 1000));
      const t = (now / 1000) % 60;
      const cpuBase = 30 + 20 * Math.sin(t / 3);

      const cores = Array.from({ length: 8 }, (_, idx) => {
        const offset = (idx - 4) * 2;
        const v = cpuBase + offset + 5 * Math.sin(t / (4 + idx));
        return Math.max(0, Math.min(100, v));
      });

      const total =
        cores.length === 0
          ? 0
          : cores.reduce((sum, v) => sum + v, 0) / cores.length;

      const snapshot: SystemMetricsSnapshot = {
        timestamp: now,
        uptimeSeconds,
        cpu: {
          cores,
          total,
        },
        memory: {
          totalBytes: 16 * 1024 * 1024 * 1024,
          usedBytes:
            8 * 1024 * 1024 * 1024 +
            Math.round(
              (2 * 1024 * 1024 * 1024 * (1 + Math.sin(t / 5))) / 2,
            ),
        },
        disk: {
          io: [
            {
              device: "total",
              readBps: 1_000_000 + Math.round(500_000 * Math.abs(Math.sin(t / 7))),
              writeBps: 500_000 + Math.round(250_000 * Math.abs(Math.cos(t / 5))),
            },
          ],
        },
        network: {
          interfaces: [
            {
              name: "eth0",
              rxBps: 2_000_000 + Math.round(1_000_000 * Math.abs(Math.sin(t / 4))),
              txBps: 1_000_000 + Math.round(500_000 * Math.abs(Math.cos(t / 6))),
            },
          ],
        },
        gpu: {
          available: true,
          gpuPercent: Math.round(cpuBase),
          memoryPercent: Math.round(
            50 + 30 * Math.sin(t / 6),
          ),
          error: undefined,
        },
      };

      pushSnapshot(snapshot);
    }, mockIntervalMs);
  };

  const stopMockStream = () => {
    if (mockTimer !== null) {
      clearInterval(mockTimer);
      mockTimer = null;
    }
  };

  const start = async () => {
    if (isActive.value) return;
    isActive.value = true;
    snapshots.value = [];
    lastPushedAt = 0;

    if (hasTauri()) {
      const mergeHistory = (history: SystemMetricsSnapshot[]) => {
        if (!Array.isArray(history) || history.length === 0) return;
        const combined = [...history, ...snapshots.value];
        combined.sort((a, b) => a.timestamp - b.timestamp);
        // Deduplicate by timestamp (good enough for our sampling contract).
        const deduped: SystemMetricsSnapshot[] = [];
        for (const snapshot of combined) {
          const last = deduped[deduped.length - 1];
          if (last && last.timestamp === snapshot.timestamp) continue;
          deduped.push(snapshot);
        }
        if (deduped.length > historyLimit) {
          snapshots.value = deduped.slice(deduped.length - historyLimit);
        } else {
          snapshots.value = deduped;
        }
      };

      try {
        const throttleMs = viewUpdateMinIntervalMs;
        metricsUnlisten = await listen<SystemMetricsSnapshot>(
          METRICS_EVENT_NAME,
          (event) => {
            const now = Date.now();
            if (!lastPushedAt || throttleMs === 0 || now - lastPushedAt >= throttleMs) {
              lastPushedAt = now;
              pushSnapshot(event.payload);
            }
          },
        );
      } catch (error) {
        console.error("Failed to listen for system metrics events:", error);
      }

      try {
        await metricsSubscribe();
      } catch (error) {
        console.error("Failed to subscribe to system metrics:", error);
      }

      try {
        const history = await fetchMetricsHistory();
        mergeHistory(history);
      } catch (error) {
        console.error("Failed to fetch system metrics history:", error);
      }
    } else {
      startMockStream();
    }
  };

  const stop = async () => {
    if (!isActive.value) return;
    isActive.value = false;

    if (metricsUnlisten) {
      try {
        metricsUnlisten();
      } catch (error) {
        console.error("Failed to unlisten system metrics:", error);
      } finally {
        metricsUnlisten = null;
      }
    }

    if (hasTauri()) {
      try {
        await metricsUnsubscribe();
      } catch (error) {
        console.error("Failed to unsubscribe from system metrics:", error);
      }
    }

    stopMockStream();
  };

  onMounted(() => {
    void start();
  });

  onUnmounted(() => {
    void stop();
  });

  const cpuTotalSeries = computed<TimePoint[]>(() =>
    snapshots.value.map((s) => ({
      timestamp: s.timestamp,
      value: s.cpu.total,
    })),
  );

  const perCoreSeries = computed<CoreSeries[]>(() => {
    if (snapshots.value.length === 0) return [];

    const latest = snapshots.value[snapshots.value.length - 1];
    const coreCount = latest.cpu.cores.length;
    const visibleCores = Math.min(coreCount, MAX_CORES_FOR_CHART);

    const result: CoreSeries[] = [];
    for (let coreIndex = 0; coreIndex < visibleCores; coreIndex += 1) {
      const values: TimePoint[] = snapshots.value.map((s) => ({
        timestamp: s.timestamp,
        value: s.cpu.cores[coreIndex] ?? 0,
      }));
      result.push({ coreIndex, values });
    }
    return result;
  });

  const memorySeries = computed<MemoryPoint[]>(() =>
    snapshots.value.map((s) => ({
      timestamp: s.timestamp,
      usedBytes: s.memory.usedBytes,
      totalBytes: s.memory.totalBytes,
    })),
  );

  const diskSeries = computed<DiskPoint[]>(() =>
    snapshots.value.map((s) => {
      const io = s.disk.io[0];
      return {
        timestamp: s.timestamp,
        readBps: io?.readBps ?? 0,
        writeBps: io?.writeBps ?? 0,
      };
    }),
  );

  const networkSeries = computed<NetworkSeries[]>(() => {
    const byName = new Map<string, NetworkSeries>();

    for (const snapshot of snapshots.value) {
      for (const iface of snapshot.network.interfaces) {
        const key = iface.name;
        let entry = byName.get(key);
        if (!entry) {
          entry = { name: key, values: [] };
          byName.set(key, entry);
        }
        entry.values.push({
          timestamp: snapshot.timestamp,
          rxBps: iface.rxBps,
          txBps: iface.txBps,
        });
      }
    }

    return Array.from(byName.values());
  });

  return {
    snapshots,
    cpuTotalSeries,
    perCoreSeries,
    memorySeries,
    diskSeries,
    networkSeries,
    start,
    stop,
  };
}
