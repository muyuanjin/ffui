import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { hasTauri, metricsSubscribe, metricsUnsubscribe, fetchMetricsHistory } from "@/lib/backend";
import type { SystemMetricsSnapshot } from "@/types";
import { createUnlistenHandle } from "@/lib/tauriUnlisten";

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
  cpuTotalSeries: Readonly<Ref<TimePoint[]>>;
  perCoreSeries: Readonly<Ref<CoreSeries[]>>;
  memorySeries: Readonly<Ref<MemoryPoint[]>>;
  diskSeries: Readonly<Ref<DiskPoint[]>>;
  networkSeries: Readonly<Ref<NetworkSeries[]>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const METRICS_EVENT_NAME = "system-metrics://update";
const MAX_CORES_FOR_CHART = 32;

export function useSystemMetrics(options: UseSystemMetricsOptions = {}): UseSystemMetricsReturn {
  const historyLimit = options.historyLimit ?? 600;
  const mockIntervalMs = options.mockIntervalMs ?? 1000;
  const viewUpdateMinIntervalMs = options.viewUpdateMinIntervalMs ?? 0;

  const snapshots = ref<SystemMetricsSnapshot[]>([]);
  const cpuTotalSeries = ref<TimePoint[]>([]);
  const perCoreSeries = ref<CoreSeries[]>([]);
  const memorySeries = ref<MemoryPoint[]>([]);
  const diskSeries = ref<DiskPoint[]>([]);
  const networkSeries = ref<NetworkSeries[]>([]);
  const networkSeriesByName = new Map<string, NetworkSeries>();

  const isActive = ref(false);

  const metricsListener = createUnlistenHandle(METRICS_EVENT_NAME);
  let mockTimer: number | null = null;
  let mockBootAtMs: number | null = null;
  let lastPushedAt = 0;

  const resetDerivedSeries = () => {
    cpuTotalSeries.value = [];
    perCoreSeries.value = [];
    memorySeries.value = [];
    diskSeries.value = [];
    networkSeries.value = [];
    networkSeriesByName.clear();
  };

  const rebuildDerivedSeries = (source: SystemMetricsSnapshot[]) => {
    resetDerivedSeries();
    if (source.length === 0) return;

    cpuTotalSeries.value = source.map((s) => ({ timestamp: s.timestamp, value: s.cpu.total }));
    memorySeries.value = source.map((s) => ({
      timestamp: s.timestamp,
      usedBytes: s.memory.usedBytes,
      totalBytes: s.memory.totalBytes,
    }));
    diskSeries.value = source.map((s) => {
      const io = s.disk.io[0];
      return { timestamp: s.timestamp, readBps: io?.readBps ?? 0, writeBps: io?.writeBps ?? 0 };
    });

    const latest = source[source.length - 1];
    const visibleCores = Math.min(latest.cpu.cores.length, MAX_CORES_FOR_CHART);
    perCoreSeries.value = Array.from({ length: visibleCores }, (_, coreIndex) => ({
      coreIndex,
      values: source.map((s) => ({
        timestamp: s.timestamp,
        value: s.cpu.cores[coreIndex] ?? 0,
      })),
    }));

    for (const snapshot of source) {
      for (const iface of snapshot.network.interfaces) {
        const key = iface.name;
        let entry = networkSeriesByName.get(key);
        if (!entry) {
          entry = { name: key, values: [] };
          networkSeriesByName.set(key, entry);
        }
        entry.values.push({ timestamp: snapshot.timestamp, rxBps: iface.rxBps, txBps: iface.txBps });
      }
    }
    networkSeries.value = Array.from(networkSeriesByName.values());
  };

  const trimDerivedSeriesByCount = (removeCount: number) => {
    if (removeCount <= 0) return;
    cpuTotalSeries.value.splice(0, removeCount);
    memorySeries.value.splice(0, removeCount);
    diskSeries.value.splice(0, removeCount);
    for (const series of perCoreSeries.value) {
      series.values.splice(0, removeCount);
    }

    const cutoff = snapshots.value[0]?.timestamp;
    if (typeof cutoff !== "number") {
      for (const series of networkSeries.value) {
        series.values.splice(0, series.values.length);
      }
      return;
    }
    for (const series of networkSeries.value) {
      let keepFrom = 0;
      while (keepFrom < series.values.length && series.values[keepFrom]!.timestamp < cutoff) keepFrom += 1;
      if (keepFrom > 0) series.values.splice(0, keepFrom);
    }
  };

  const pushSnapshot = (snapshot: SystemMetricsSnapshot) => {
    snapshots.value.push(snapshot);

    cpuTotalSeries.value.push({ timestamp: snapshot.timestamp, value: snapshot.cpu.total });
    memorySeries.value.push({
      timestamp: snapshot.timestamp,
      usedBytes: snapshot.memory.usedBytes,
      totalBytes: snapshot.memory.totalBytes,
    });
    const io = snapshot.disk.io[0];
    diskSeries.value.push({ timestamp: snapshot.timestamp, readBps: io?.readBps ?? 0, writeBps: io?.writeBps ?? 0 });

    const visibleCores = Math.min(snapshot.cpu.cores.length, MAX_CORES_FOR_CHART);
    if (perCoreSeries.value.length !== visibleCores) {
      rebuildDerivedSeries(snapshots.value);
    } else {
      for (const series of perCoreSeries.value) {
        series.values.push({ timestamp: snapshot.timestamp, value: snapshot.cpu.cores[series.coreIndex] ?? 0 });
      }
    }

    for (const iface of snapshot.network.interfaces) {
      const key = iface.name;
      let entry = networkSeriesByName.get(key);
      if (!entry) {
        entry = { name: key, values: [] };
        networkSeriesByName.set(key, entry);
        networkSeries.value.push(entry);
      }
      entry.values.push({ timestamp: snapshot.timestamp, rxBps: iface.rxBps, txBps: iface.txBps });
    }

    if (snapshots.value.length > historyLimit) {
      const removeCount = snapshots.value.length - historyLimit;
      snapshots.value.splice(0, removeCount);
      trimDerivedSeriesByCount(removeCount);
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

      const total = cores.length === 0 ? 0 : cores.reduce((sum, v) => sum + v, 0) / cores.length;

      const snapshot: SystemMetricsSnapshot = {
        timestamp: now,
        uptimeSeconds,
        cpu: {
          cores,
          total,
        },
        memory: {
          totalBytes: 16 * 1024 * 1024 * 1024,
          usedBytes: 8 * 1024 * 1024 * 1024 + Math.round((2 * 1024 * 1024 * 1024 * (1 + Math.sin(t / 5))) / 2),
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
          memoryPercent: Math.round(50 + 30 * Math.sin(t / 6)),
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
    resetDerivedSeries();
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
        const next = deduped.length > historyLimit ? deduped.slice(deduped.length - historyLimit) : deduped;
        snapshots.value = next;
        rebuildDerivedSeries(next);
      };

      try {
        const throttleMs = viewUpdateMinIntervalMs;
        const unlisten = await listen<SystemMetricsSnapshot>(METRICS_EVENT_NAME, (event) => {
          const now = Date.now();
          if (!lastPushedAt || throttleMs === 0 || now - lastPushedAt >= throttleMs) {
            lastPushedAt = now;
            pushSnapshot(event.payload);
          }
        });
        metricsListener.replace(unlisten);
      } catch (error) {
        console.error("Failed to listen for system metrics events:", error);
        metricsListener.replace(null);
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
    metricsListener.clear();

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
