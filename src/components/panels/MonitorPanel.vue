<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import VChart from "vue-echarts";
import "echarts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";

defineProps<{
  /** Legacy CPU usage snapshot from backend (basic polling). Kept for compatibility. */
  cpuSnapshot: CpuUsageSnapshot | null;
  /** Legacy GPU usage snapshot from backend (NVML-based). Kept for compatibility. */
  gpuSnapshot: GpuUsageSnapshot | null;
}>();

const { t } = useI18n();

const {
  snapshots,
  cpuTotalSeries,
  perCoreSeries,
  memorySeries,
  diskSeries,
  networkSeries,
} = useSystemMetrics();

const MAX_HISTORY_POINTS = 120;

// 统一的轻量级过渡动画配置，让高频刷新时视觉更连贯。
// 对于实时监控场景，ECharts 自带的补间动画在高频刷新下容易出现“顿挫”和形状抖动，
// 这里直接关闭图表层面的动画，只依赖较高的采样频率来保证视觉连贯性。
const CHART_ANIMATION = {
  animation: false,
  animationDuration: 0,
  animationDurationUpdate: 0,
} as const;

// Prefer GPU metrics from the streaming system-metrics pipeline so the
// performance view no longer depends on polling commands.
const latestGpu = computed<GpuUsageSnapshot | null>(() => {
  const last = snapshots.value[snapshots.value.length - 1];
  if (last && last.gpu) return last.gpu;
  return null;
});

const hasMetrics = computed(() => snapshots.value.length > 0);

const cpuTotalOption = computed(() => {
  const allPoints = cpuTotalSeries.value;
  const points =
    allPoints.length > MAX_HISTORY_POINTS
      ? allPoints.slice(allPoints.length - MAX_HISTORY_POINTS)
      : allPoints;
  return {
    ...CHART_ANIMATION,
    grid: { left: 40, right: 8, top: 16, bottom: 24 },
    xAxis: {
      type: "category",
      data: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
      boundaryGap: false,
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        name: "CPU",
        type: "line",
        data: points.map((p) => p.value),
        showSymbol: false,
        smooth: true,
        areaStyle: {},
      },
    ],
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        return `${value.toFixed(1)}%`;
      },
    },
  };
});

const cpuPerCoreOption = computed(() => {
  const baseAxisAll = cpuTotalSeries.value;
  const axisPoints =
    baseAxisAll.length > MAX_HISTORY_POINTS
      ? baseAxisAll.slice(baseAxisAll.length - MAX_HISTORY_POINTS)
      : baseAxisAll;

  const series = perCoreSeries.value.map((core) => {
    const valuesAll = core.values;
    const values =
      valuesAll.length > MAX_HISTORY_POINTS
        ? valuesAll.slice(valuesAll.length - MAX_HISTORY_POINTS)
        : valuesAll;

    return {
      name: `C${core.coreIndex}`,
      type: "line",
      data: values.map((p) => p.value),
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 1 },
    };
  });

  return {
    ...CHART_ANIMATION,
    grid: { left: 40, right: 8, top: 32, bottom: 24 },
    xAxis: {
      type: "category",
      data: axisPoints.map((p) =>
        new Date(p.timestamp).toLocaleTimeString(),
      ),
      boundaryGap: false,
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    legend: {
      type: "scroll",
    },
    series,
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        return `${value.toFixed(0)}%`;
      },
    },
  };
});

const memoryOption = computed(() => {
  const allPoints = memorySeries.value;
  const points =
    allPoints.length > MAX_HISTORY_POINTS
      ? allPoints.slice(allPoints.length - MAX_HISTORY_POINTS)
      : allPoints;
  return {
    ...CHART_ANIMATION,
    grid: { left: 40, right: 8, top: 16, bottom: 24 },
    xAxis: {
      type: "category",
      data: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
      boundaryGap: false,
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter(val: number) {
          return `${(val / (1024 * 1024 * 1024)).toFixed(0)}G`;
        },
      },
    },
    series: [
      {
        name: "Used",
        type: "line",
        data: points.map((p) => p.usedBytes),
        showSymbol: false,
        smooth: true,
        areaStyle: {},
      },
    ],
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      },
    },
  };
});

const diskOption = computed(() => {
  const allPoints = diskSeries.value;
  const points =
    allPoints.length > MAX_HISTORY_POINTS
      ? allPoints.slice(allPoints.length - MAX_HISTORY_POINTS)
      : allPoints;
  return {
    ...CHART_ANIMATION,
    grid: { left: 40, right: 8, top: 16, bottom: 24 },
    xAxis: {
      type: "category",
      data: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
      boundaryGap: false,
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter(val: number) {
          return `${(val / (1024 * 1024)).toFixed(0)} MB/s`;
        },
      },
    },
    series: [
      {
        name: "Read",
        type: "line",
        data: points.map((p) => p.readBps),
        showSymbol: false,
        smooth: true,
      },
      {
        name: "Write",
        type: "line",
        data: points.map((p) => p.writeBps),
        showSymbol: false,
        smooth: true,
      },
    ],
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
      },
    },
  };
});

const networkOption = computed(() => {
  const allSeries = networkSeries.value;
  if (allSeries.length === 0) {
    return {
      ...CHART_ANIMATION,
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    };
  }

  const baseInterface = allSeries[0];
  const baseValuesAll = baseInterface.values;
  const baseValues =
    baseValuesAll.length > MAX_HISTORY_POINTS
      ? baseValuesAll.slice(baseValuesAll.length - MAX_HISTORY_POINTS)
      : baseValuesAll;

  const series = allSeries.flatMap((iface) => {
    const valuesAll = iface.values;
    const values =
      valuesAll.length > MAX_HISTORY_POINTS
        ? valuesAll.slice(valuesAll.length - MAX_HISTORY_POINTS)
        : valuesAll;

    return [
      {
        name: `${iface.name} RX`,
        type: "line",
        data: values.map((p) => p.rxBps),
        showSymbol: false,
        smooth: true,
      },
      {
        name: `${iface.name} TX`,
        type: "line",
        data: values.map((p) => p.txBps),
        showSymbol: false,
        smooth: true,
      },
    ];
  });

  return {
    ...CHART_ANIMATION,
    grid: { left: 40, right: 8, top: 32, bottom: 24 },
    xAxis: {
      type: "category",
      data: baseValues.map((p) =>
        new Date(p.timestamp).toLocaleTimeString(),
      ),
      boundaryGap: false,
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter(val: number) {
          return `${(val / (1024 * 1024)).toFixed(0)} MB/s`;
        },
      },
    },
    legend: {
      type: "scroll",
    },
    series,
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
      },
    },
  };
});
</script>

<template>
  <section class="max-w-6xl mx-auto py-6 text-sm text-muted-foreground">
    <div
      v-if="!hasMetrics"
      class="flex flex-col items-center justify-center h-64 gap-2"
    >
      <p>{{ t("monitor.emptyTitle") }}</p>
      <p class="text-xs text-muted-foreground/80">
        {{ t("monitor.emptyDescription") }}
      </p>
    </div>

    <div
      v-else
      class="grid gap-4 lg:grid-cols-2"
    >
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.cpuOverall") }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VChart
            class="w-full h-48"
            :option="cpuTotalOption"
            autoresize
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.cpuPerCore") }}
            <span class="text-[11px] text-muted-foreground/80">
              {{
                t("monitor.cpuPerCoreSuffix", {
                  count: perCoreSeries.length,
                })
              }}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VChart
            class="w-full h-48"
            :option="cpuPerCoreOption"
            autoresize
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.memory") }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VChart
            class="w-full h-48"
            :option="memoryOption"
            autoresize
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.diskIo") }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VChart
            class="w-full h-48"
            :option="diskOption"
            autoresize
          />
        </CardContent>
      </Card>

      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.networkIo") }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VChart
            class="w-full h-56"
            :option="networkOption"
            autoresize
          />
        </CardContent>
      </Card>

      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("monitor.gpuTitle") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="text-xs space-y-1">
          <p v-if="latestGpu && latestGpu.available">
            {{ t("monitor.gpuUsage") }}
            <span class="font-mono text-foreground">
              {{ latestGpu.gpuPercent ?? 0 }}%
            </span>
          </p>
          <p
            v-if="
              latestGpu &&
              latestGpu.available &&
              latestGpu.memoryPercent !== undefined
            "
          >
            {{ t("monitor.gpuMemoryUsage") }}
            <span class="font-mono text-foreground">
              {{ latestGpu.memoryPercent }}%
            </span>
          </p>
          <p v-if="latestGpu && !latestGpu.available">
            {{ latestGpu.error ?? (t("monitor.gpuUnavailable") as string) }}
          </p>
          <p v-if="!latestGpu">
            {{ t("monitor.gpuWaiting") }}
          </p>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
