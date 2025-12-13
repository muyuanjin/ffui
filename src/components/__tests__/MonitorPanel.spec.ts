// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createI18n } from "vue-i18n";

import type { SystemMetricsSnapshot } from "@/types";

// Stub vue-echarts so we don't pull in the full ECharts renderer in tests.
vi.mock("vue-echarts", () => ({
  __esModule: true,
  default: {
    name: "VChart",
    props: ["option", "autoresize"],
    template: "<div class=\"vchart-stub\" />",
  },
}));

// Provide a lightweight stub for useSystemMetrics that we can drive from tests
// by mutating the shared `snapshots` ref.
const snapshots = ref<SystemMetricsSnapshot[]>([]);

const cpuTotalSeries = computed(() =>
  snapshots.value.map((s) => ({ timestamp: s.timestamp, value: s.cpu.total })),
);

const perCoreSeries = computed(() => {
  if (snapshots.value.length === 0) return [];
  const coreCount = snapshots.value[0].cpu.cores.length;
  const series = [];
  for (let coreIndex = 0; coreIndex < coreCount; coreIndex += 1) {
    series.push({
      coreIndex,
      values: snapshots.value.map((s) => ({
        timestamp: s.timestamp,
        value: s.cpu.cores[coreIndex] ?? 0,
      })),
    });
  }
  return series;
});

const memorySeries = computed(() =>
  snapshots.value.map((s) => ({
    timestamp: s.timestamp,
    usedBytes: s.memory.usedBytes,
    totalBytes: s.memory.totalBytes,
  })),
);

const diskSeries = computed(() =>
  snapshots.value.map((s) => {
    const io = s.disk.io[0];
    return {
      timestamp: s.timestamp,
      readBps: io?.readBps ?? 0,
      writeBps: io?.writeBps ?? 0,
    };
  }),
);

const networkSeries = computed(() => {
  if (snapshots.value.length === 0) return [];
  return [
    {
      name: "eth0",
      values: snapshots.value.map((s) => {
        const iface = s.network.interfaces[0];
        return {
          timestamp: s.timestamp,
          rxBps: iface?.rxBps ?? 0,
          txBps: iface?.txBps ?? 0,
        };
      }),
    },
  ];
});

vi.mock("@/composables", () => ({
  useSystemMetrics: () => ({
    snapshots,
    cpuTotalSeries,
    perCoreSeries,
    memorySeries,
    diskSeries,
    networkSeries,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

import MonitorPanel from "../panels/MonitorPanel.vue";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const makeSnapshot = (timestamp: number, cores: number, interfaces: number): SystemMetricsSnapshot => ({
  timestamp,
  uptimeSeconds: 3600,
  cpu: {
    cores: Array.from({ length: cores }, (_, idx) => (idx * 3 + (timestamp % 100)) % 100),
    total: 50,
  },
  memory: {
    usedBytes: 8 * 1024 * 1024 * 1024,
    totalBytes: 16 * 1024 * 1024 * 1024,
  },
  disk: {
    io: [
      {
        device: "total",
        readBps: 1_000_000,
        writeBps: 500_000,
      },
    ],
  },
  network: {
    interfaces: Array.from({ length: interfaces }, (_, idx) => ({
      name: `eth${idx}`,
      rxBps: 2_000_000 + idx * 100_000,
      txBps: 1_000_000 + idx * 50_000,
    })),
  },
});

describe("MonitorPanel", () => {
  beforeEach(() => {
    snapshots.value = [];
  });

  it("renders empty state when no metrics are available", () => {
    const wrapper = mount(MonitorPanel, {
      props: {
        cpuSnapshot: null,
        gpuSnapshot: null,
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.text()).toContain("正在等待系统性能数据");
    expect(wrapper.findAll(".vchart-stub").length).toBe(0);
  });

  it("renders charts without crashing for large metrics arrays", () => {
    // Simulate a host with many cores and a long history window.
    const coreCount = 128;
    const historyLength = 60;
    snapshots.value = Array.from({ length: historyLength }, (_, i) =>
      makeSnapshot(1_700_000_000_000 + i * 1_000, coreCount, 2),
    );

    const wrapper = mount(MonitorPanel, {
      props: {
        cpuSnapshot: {
          overall: 42,
          perCore: Array.from({ length: coreCount }, () => 42),
        },
        gpuSnapshot: {
          available: true,
          gpuPercent: 30,
          memoryPercent: 40,
          error: undefined,
        },
      },
      global: {
        plugins: [i18n],
      },
    });

    // All chart containers should render using the stubbed component.
    const charts = wrapper.findAll(".vchart-stub");
    expect(charts.length).toBeGreaterThanOrEqual(4);

    // Title text should be present so we know the layout rendered.
    expect(wrapper.text()).toContain("CPU 总体");
    expect(wrapper.text()).toContain("磁盘 I/O");
    expect(wrapper.text()).toContain("网络 I/O");
  });
});
