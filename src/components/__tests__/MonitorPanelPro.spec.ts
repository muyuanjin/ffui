// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { createI18n } from "vue-i18n";

import type { SystemMetricsSnapshot } from "@/types";

import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

// Stub vue-echarts so we don't pull in the full ECharts renderer in tests.
vi.mock("vue-echarts", () => ({
  __esModule: true,
  default: {
    name: "VChart",
    props: ["option", "autoresize"],
    template: "<div class=\"vchart-stub\" />",
  },
}));

// Stub gsap so the numeric interpolation executes synchronously in tests.
vi.mock("gsap", () => ({
  __esModule: true,
  default: {
    to(target: Record<string, unknown>, vars: Record<string, unknown>) {
      Object.assign(target, vars);
    },
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

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

import MonitorPanelPro from "../panels/MonitorPanelPro.vue";

const makeSnapshot = (
  timestamp: number,
  cores: number,
  interfaces: number,
): SystemMetricsSnapshot => ({
  timestamp,
  cpu: {
    cores: Array.from(
      { length: cores },
      (_, idx) => (idx * 3 + (timestamp % 100)) % 100,
    ),
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
  // GPU 字段在这里留空即可，组件会自动回退到 0 / "--"。
} as SystemMetricsSnapshot);

describe("MonitorPanelPro", () => {
  beforeEach(() => {
    snapshots.value = [];
  });

  it("renders GPU / heatmap / mini charts via vue-echarts", () => {
    const coreCount = 16;
    const historyLength = 40;
    snapshots.value = Array.from({ length: historyLength }, (_, i) =>
      makeSnapshot(1_700_000_000_000 + i * 1_000, coreCount, 1),
    );

    const wrapper = mount(MonitorPanelPro, {
      props: {
        cpuSnapshot: null,
        gpuSnapshot: null,
      },
      global: {
        plugins: [i18n],
      },
    });

    // GPU 状态卡片内应渲染 VChart stub
    expect(wrapper.find(".gpu-card .vchart-stub").exists()).toBe(true);

    // CPU 核心热力图区域也应渲染 VChart stub
    expect(wrapper.find(".heatmap-section .vchart-stub").exists()).toBe(true);

    // 底部 NETWORK / DISK 迷你图各一个 VChart stub
    const miniCharts = wrapper.findAll(".metrics-grid .vchart-stub");
    expect(miniCharts.length).toBe(2);

    // 关键标题文本存在，确保布局渲染正常
    expect(wrapper.text()).toContain("GPU STATUS");
    expect(wrapper.text()).toContain("NETWORK I/O");
    expect(wrapper.text()).toContain("DISK I/O");
  });

  it("renders CPU / MEMORY / GPU summary as bar meters instead of plain numbers", () => {
    const coreCount = 4;
    const historyLength = 5;
    snapshots.value = Array.from({ length: historyLength }, (_, i) =>
      makeSnapshot(1_700_000_000_000 + i * 1_000, coreCount, 1),
    );

    const wrapper = mount(MonitorPanelPro, {
      props: {
        cpuSnapshot: null,
        gpuSnapshot: null,
      },
      global: {
        plugins: [i18n],
      },
    });

    const summaryCard = wrapper
      .findAll(".metric-card")
      .find((card) => card.text().includes("CPU / MEMORY / GPU"));

    expect(summaryCard, "CPU / MEMORY / GPU summary card should exist").toBeTruthy();

    const bars = summaryCard!.findAll(".resource-item .resource-bar");
    expect(bars.length).toBe(3);
  });
});
