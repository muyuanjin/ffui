import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSystemMetrics } from "@/composables";
import type { EChartsCoreOption } from "echarts/core";
import {
  smoothEma,
  createFixedBuffer,
  MINI_CHART_WINDOW,
  GPU_CHART_WINDOW,
  useGpuMetrics,
  useTranscodeActivityToday,
} from "@/composables/monitor";

const CHART_ANIMATION = {
  animation: false,
  animationDuration: 0,
  animationDurationUpdate: 0,
} as const;

const HEATMAP_TIME_WINDOW = 30;

type MiniLineSeries = {
  name: string;
  data: number[];
};

const createAxisTooltip = (formatValue: (value: number) => string) => ({
  trigger: "axis" as const,
  valueFormatter(value: number) {
    if (typeof value !== "number" || Number.isNaN(value)) return "--";
    return formatValue(value);
  },
  formatter: (params: unknown) => {
    if (!Array.isArray(params) || params.length === 0) return "";
    const first = params[0];
    if (!first || typeof first !== "object") return "";
    const record = first as Record<string, unknown>;
    const seriesName = typeof record.seriesName === "string" ? record.seriesName : "";
    const value = record.value;
    if (!seriesName || typeof value !== "number" || Number.isNaN(value)) return "";
    return `${seriesName}: ${formatValue(value)}`;
  },
});

const getHeadroomMax = (values: number[]): number => {
  const maxValue = values.reduce((max, v) => (v > max ? v : max), 0);
  return maxValue <= 0 ? 1 : maxValue * 1.2;
};

const createMiniThroughputChartOption = (labels: string[], series: MiniLineSeries[]) => {
  const allValues = series.flatMap((s) => s.data);
  const maxWithHeadroom = getHeadroomMax(allValues);

  const option = {
    ...CHART_ANIMATION,
    grid: {
      left: 4,
      right: 4,
      top: 4,
      bottom: 6,
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: maxWithHeadroom,
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      data: s.data,
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 1.5 },
    })),
    tooltip: createAxisTooltip((value) => `${value.toFixed(2)} MB/s`),
  } satisfies EChartsCoreOption;

  return option;
};

export function useMonitorPanelProState() {
  const { t } = useI18n();

  const { snapshots, cpuTotalSeries, perCoreSeries, memorySeries, diskSeries, networkSeries } = useSystemMetrics();

  const { latestGpu, gpuUsageSeries, gpuMemorySeries } = useGpuMetrics(snapshots);

  const latestMetrics = computed(() => {
    const latest = snapshots.value[snapshots.value.length - 1];
    if (!latest) return null;

    const totalMemory = latest.memory.totalBytes;
    const usedMemory = latest.memory.usedBytes;
    const memoryPercent = (usedMemory / totalMemory) * 100;

    const cpuLatest = cpuTotalSeries.value[cpuTotalSeries.value.length - 1];
    const memoryLatest = memorySeries.value[memorySeries.value.length - 1];

    const gpu = latestGpu.value;

    return {
      cpu: cpuLatest?.value || latest.cpu.total,
      memory: memoryLatest ? (memoryLatest.usedBytes / memoryLatest.totalBytes) * 100 : memoryPercent,
      disk: {
        read: latest.disk.io[0]?.readBps || 0,
        write: latest.disk.io[0]?.writeBps || 0,
      },
      network: {
        rx: latest.network.interfaces[0]?.rxBps || 0,
        tx: latest.network.interfaces[0]?.txBps || 0,
      },
      gpu: {
        usage: gpu?.gpuPercent ?? 0,
        memory: gpu?.memoryPercent ?? 0,
      },
    };
  });

  const displayMetrics = ref({
    cpu: 0,
    memory: 0,
    gpuUsage: 0,
    gpuMemory: 0,
    diskReadMbps: 0,
    diskWriteMbps: 0,
    netRxMbps: 0,
    netTxMbps: 0,
  });

  const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

  const cpuPercent = computed(() => clampPercent(displayMetrics.value.cpu));
  const memoryPercent = computed(() => clampPercent(displayMetrics.value.memory));
  const gpuPercent = computed(() => clampPercent(displayMetrics.value.gpuUsage));

  watch(
    latestMetrics,
    (next) => {
      if (!next) return;
      const target = {
        cpu: next.cpu,
        memory: next.memory,
        gpuUsage: next.gpu.usage,
        gpuMemory: next.gpu.memory,
        diskReadMbps: next.disk.read / (1024 * 1024),
        diskWriteMbps: next.disk.write / (1024 * 1024),
        netRxMbps: next.network.rx / (1024 * 1024),
        netTxMbps: next.network.tx / (1024 * 1024),
      };

      displayMetrics.value = target;
    },
    { immediate: true },
  );

  const uptimeLabel = computed(() => {
    const latest = snapshots.value[snapshots.value.length - 1];
    if (!latest) return "--";
    const totalSeconds = Math.max(0, Math.floor(latest.uptimeSeconds ?? 0));
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const remMinutes = minutes % 60;
    return `${days}d ${remHours}h ${remMinutes}m`;
  });

  const { activity: transcodeActivityToday } = useTranscodeActivityToday();

  const gpuChartLabels = Array.from({ length: GPU_CHART_WINDOW }, () => "");

  const gpuChartOption = computed(() => {
    const usage = gpuUsageSeries.value;
    const memory = gpuMemorySeries.value;

    const usageBuffer = createFixedBuffer(usage, GPU_CHART_WINDOW);
    const memoryBuffer = createFixedBuffer(memory, GPU_CHART_WINDOW);

    const option = {
      ...CHART_ANIMATION,
      grid: {
        left: 8,
        right: 8,
        top: 8,
        bottom: 16,
      },
      xAxis: {
        type: "category",
        data: gpuChartLabels,
        boundaryGap: false,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          name: "GPU",
          type: "line",
          data: usageBuffer,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.2 },
        },
        {
          name: "VRAM",
          type: "line",
          data: memoryBuffer,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.2 },
        },
      ],
      tooltip: createAxisTooltip((value) => `${value.toFixed(1)}%`),
      legend: { show: false },
    } satisfies EChartsCoreOption;

    return option;
  });

  const heatmapTimeLabels = computed(() =>
    Array.from({ length: HEATMAP_TIME_WINDOW }, (_, i) => (i % 5 === 0 ? `${-HEATMAP_TIME_WINDOW + i + 1}s` : "")),
  );

  const cpuHeatmapOption = computed(() => {
    const cores = perCoreSeries.value;
    if (!cores.length) return null;

    const data: Array<[number, number, number]> = [];
    const timePoints = cores[0]?.values.length || 0;

    cores.forEach((core, coreIndex) => {
      for (let timeIndex = 0; timeIndex < HEATMAP_TIME_WINDOW; timeIndex++) {
        const dataIndex = timePoints - HEATMAP_TIME_WINDOW + timeIndex;
        const value = dataIndex >= 0 ? core.values[dataIndex]?.value || 0 : 0;
        data.push([timeIndex, coreIndex, value]);
      }
    });

    const option = {
      ...CHART_ANIMATION,
      backgroundColor: "transparent",
      grid: {
        left: 40,
        right: 15,
        top: 25,
        bottom: 20,
      },
      xAxis: {
        type: "category",
        data: heatmapTimeLabels.value,
        splitArea: { show: true },
        axisLabel: {
          color: "#666",
          fontSize: 9,
        },
      },
      yAxis: {
        type: "category",
        data: cores.map((_, i) => `C${i}`),
        splitArea: { show: true },
        axisLabel: {
          color: "#666",
          fontSize: 9,
        },
      },
      visualMap: {
        min: 0,
        max: 100,
        show: false,
        inRange: {
          color: ["#001133", "#003366", "#006699", "#0099cc", "#00ccff", "#00ff99", "#ffcc00", "#ff6600", "#ff0033"],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 255, 255, 0.5)",
            },
          },
        },
      ],
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        formatter: (params: unknown) => {
          if (!params || typeof params !== "object") return "";
          const value = (params as Record<string, unknown>).value;
          if (!Array.isArray(value) || value.length < 3) return "";
          const coreIndex = value[1];
          const percent = value[2];
          if (typeof coreIndex !== "number" || typeof percent !== "number" || Number.isNaN(percent)) return "";
          return `${t("monitor.cpu")} ${coreIndex}: ${percent.toFixed(1)}%`;
        },
      },
    } satisfies EChartsCoreOption;

    return option;
  });

  const networkMiniSeries = computed(() => {
    const firstSeries = networkSeries.value[0];
    if (!firstSeries) {
      return {
        rx: new Array(MINI_CHART_WINDOW).fill(0),
        tx: new Array(MINI_CHART_WINDOW).fill(0),
      };
    }

    const valuesAll = firstSeries.values;
    const rxRawAll = valuesAll.map((p) => p.rxBps / 1024 / 1024);
    const txRawAll = valuesAll.map((p) => p.txBps / 1024 / 1024);

    const rxSmoothAll = smoothEma(rxRawAll);
    const txSmoothAll = smoothEma(txRawAll);

    return {
      rx: createFixedBuffer(rxSmoothAll),
      tx: createFixedBuffer(txSmoothAll),
    };
  });

  const miniChartLabels = Array.from({ length: MINI_CHART_WINDOW }, () => "");

  const networkChartOption = computed(() => {
    const { rx, tx } = networkMiniSeries.value;
    return createMiniThroughputChartOption(miniChartLabels, [
      { name: "RX", data: rx },
      { name: "TX", data: tx },
    ]);
  });

  const diskMiniSeries = computed(() => {
    const pointsAll = diskSeries.value;

    if (!pointsAll.length) {
      return {
        read: new Array(MINI_CHART_WINDOW).fill(0),
        write: new Array(MINI_CHART_WINDOW).fill(0),
      };
    }

    const readRawAll = pointsAll.map((p) => p.readBps / 1024 / 1024);
    const writeRawAll = pointsAll.map((p) => p.writeBps / 1024 / 1024);

    const readSmoothAll = smoothEma(readRawAll);
    const writeSmoothAll = smoothEma(writeRawAll);

    return {
      read: createFixedBuffer(readSmoothAll),
      write: createFixedBuffer(writeSmoothAll),
    };
  });

  const diskChartOption = computed(() => {
    const { read, write } = diskMiniSeries.value;
    return createMiniThroughputChartOption(miniChartLabels, [
      { name: "Read", data: read },
      { name: "Write", data: write },
    ]);
  });

  return {
    snapshots,
    perCoreSeries,
    latestGpu,
    latestMetrics,
    displayMetrics,
    cpuPercent,
    memoryPercent,
    gpuPercent,
    gpuChartOption,
    cpuHeatmapOption,
    networkChartOption,
    diskChartOption,
    uptimeLabel,
    transcodeActivityToday,
  };
}
