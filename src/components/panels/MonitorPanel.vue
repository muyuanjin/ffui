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

// Prefer GPU metrics from the streaming system-metrics pipeline so the
// performance view no longer depends on polling commands.
const latestGpu = computed<GpuUsageSnapshot | null>(() => {
  const last = snapshots.value[snapshots.value.length - 1];
  if (last && last.gpu) return last.gpu;
  return null;
});

const hasMetrics = computed(() => snapshots.value.length > 0);

const cpuTotalOption = computed(() => {
  const points = cpuTotalSeries.value;
  return {
    animation: false,
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
  const baseAxis = cpuTotalSeries.value;
  const series = perCoreSeries.value.map((core) => ({
    name: `C${core.coreIndex}`,
    type: "line",
    data: core.values.map((p) => p.value),
    showSymbol: false,
    smooth: false,
    lineStyle: { width: 1 },
  }));

  return {
    animation: false,
    grid: { left: 40, right: 8, top: 32, bottom: 24 },
    xAxis: {
      type: "category",
      data: baseAxis.map((p) => new Date(p.timestamp).toLocaleTimeString()),
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
  const points = memorySeries.value;
  return {
    animation: false,
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
  const points = diskSeries.value;
  return {
    animation: false,
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
      animation: false,
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    };
  }

  const baseAxis = allSeries[0].values.map((p) =>
    new Date(p.timestamp).toLocaleTimeString(),
  );

  const series = allSeries.flatMap((iface) => [
    {
      name: `${iface.name} RX`,
      type: "line",
      data: iface.values.map((p) => p.rxBps),
      showSymbol: false,
      smooth: true,
    },
    {
      name: `${iface.name} TX`,
      type: "line",
      data: iface.values.map((p) => p.txBps),
      showSymbol: false,
      smooth: true,
    },
  ]);

  return {
    animation: false,
    grid: { left: 40, right: 8, top: 32, bottom: 24 },
    xAxis: {
      type: "category",
      data: baseAxis,
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
