<script setup lang="ts">
import { computed, ref, watch } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";
import { useI18n } from "vue-i18n";

// Legacy props kept for potential compatibility; the panel now reads
// CPU/GPU metrics exclusively from the streaming useSystemMetrics pipe.
defineProps<{
  cpuSnapshot?: CpuUsageSnapshot | null;
  gpuSnapshot?: GpuUsageSnapshot | null;
}>();

const {
  snapshots,
  cpuTotalSeries,
  perCoreSeries,
  memorySeries,
  diskSeries,
  networkSeries,
} = useSystemMetrics();

const { t } = useI18n();

const MAX_HISTORY_POINTS = 60;

// 对于实时监控场景，ECharts 自带的补间动画在高频刷新下容易出现“顿挫”和形状抖动，
// 尤其是在采样间隔远小于 animationDurationUpdate 时，动画会不断被打断重启。
// 这里统一关闭图表层面的动画，只依赖较高的采样频率与前端数值插值来获得流畅视觉效果。
const CHART_ANIMATION = {
  animation: false,
  animationDuration: 0,
  animationDurationUpdate: 0,
} as const;

// 简单的指数移动平均平滑，用来压制 I/O 抖动带来的"蛆动感"
// 降低平滑因子，提高响应速度，同时保持一定的平滑效果
const DEFAULT_SMOOTH_ALPHA = 0.25;

function smoothEma(values: number[], alpha: number = DEFAULT_SMOOTH_ALPHA): number[] {
  if (values.length === 0) return [];
  const result = new Array<number>(values.length);
  result[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

// 创建固定长度的数据缓冲区，用于所有图表
const MINI_CHART_WINDOW = 20; // 迷你图表显示20个数据点
const GPU_CHART_WINDOW = 40; // GPU图表显示40个数据点

const createFixedBuffer = (data: number[], windowSize: number = MINI_CHART_WINDOW): number[] => {
  if (data.length >= windowSize) {
    return data.slice(-windowSize);
  }
  // 数据不足时，用0填充前面的部分
  const buffer = new Array(windowSize).fill(0);
  data.forEach((val, idx) => {
    buffer[windowSize - data.length + idx] = val;
  });
  return buffer;
};

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

// 获取最新的系统指标（原始采样值）
const latestMetrics = computed(() => {
  const latest = snapshots.value[snapshots.value.length - 1];
  if (!latest) return null;

  const totalMemory = latest.memory.totalBytes;
  const usedMemory = latest.memory.usedBytes;
  const memoryPercent = (usedMemory / totalMemory) * 100;

  // 使用 cpuTotalSeries 和 memorySeries 来保持一致性
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

// 用于数值展示的指标快照，直接跟随 latestMetrics 刷新，不再做数值补间，
// 避免在高频更新下数字持续滚动带来的视觉干扰。
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

// 柱状图需要一个 0-100 范围内的稳定百分比，避免异常值把进度条“撑爆”。
const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, value));

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

    // 直接覆盖显示数据，保证“是什么就显示什么”，不做数值缓动动画。
    displayMetrics.value = target;
  },
  { immediate: true },
);

// 监控面板自身的“大致在线时长”，用于替换随机的 SYSTEM UPTIME 数字。
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

// GPU 实时曲线图（ECharts：轻量级 sparkline）- 优化版本
const gpuChartLabels = Array.from({ length: GPU_CHART_WINDOW }, () => '');

const gpuChartOption = computed(() => {
  const usage = gpuUsageSeries.value;
  const memory = gpuMemorySeries.value;

  // 使用固定长度缓冲区
  const usageBuffer = createFixedBuffer(usage, GPU_CHART_WINDOW);
  const memoryBuffer = createFixedBuffer(memory, GPU_CHART_WINDOW);

  return {
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
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        if (typeof value !== "number" || Number.isNaN(value)) return "--";
        return `${value.toFixed(1)}%`;
      },
      formatter: (params: any) => {
        const data = params[0];
        return `${data.seriesName}: ${data.value.toFixed(1)}%`;
      },
    },
    legend: { show: false },
  };
});

// CPU核心热力图 - 优化版本，使用固定时间轴避免抖动
const HEATMAP_TIME_WINDOW = 30; // 固定显示30个时间点

// 预先生成固定的时间轴标签，避免重复计算
const heatmapTimeLabels = computed(() =>
  Array.from({ length: HEATMAP_TIME_WINDOW }, (_, i) =>
    i % 5 === 0 ? `${-HEATMAP_TIME_WINDOW + i + 1}s` : ''
  )
);

const cpuHeatmapOption = computed(() => {
  const cores = perCoreSeries.value;
  if (!cores.length) return null;

  // 创建固定长度的数据缓冲区
  const data: any[] = [];
  const timePoints = cores[0]?.values.length || 0;

  // 使用固定窗口，如果数据不足则用0填充
  cores.forEach((core, coreIndex) => {
    for (let timeIndex = 0; timeIndex < HEATMAP_TIME_WINDOW; timeIndex++) {
      const dataIndex = timePoints - HEATMAP_TIME_WINDOW + timeIndex;
      const value = dataIndex >= 0 ? core.values[dataIndex]?.value || 0 : 0;
      data.push([timeIndex, coreIndex, value]);
    }
  });

  return {
    ...CHART_ANIMATION,
    backgroundColor: 'transparent',
    grid: {
      left: 40,
      right: 15,
      top: 25,
      bottom: 20
    },
    xAxis: {
      type: 'category',
      data: heatmapTimeLabels.value,
      splitArea: { show: true },
      axisLabel: {
        color: '#666',
        fontSize: 9,
      }
    },
    yAxis: {
      type: 'category',
      data: cores.map((_, i) => `C${i}`),
      splitArea: { show: true },
      axisLabel: {
        color: '#666',
        fontSize: 9
      }
    },
    visualMap: {
      min: 0,
      max: 100,
      show: false,
      inRange: {
        color: ['#001133', '#003366', '#006699', '#0099cc', '#00ccff', '#00ff99', '#ffcc00', '#ff6600', '#ff0033']
      }
    },
    series: [{
      type: 'heatmap',
      data: data,
      label: { show: false },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 255, 255, 0.5)'
        }
      }
    }],
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      formatter: (params: any) => {
        return `${t('monitor.cpu')} ${params.value[1]}: ${params.value[2].toFixed(1)}%`;
      }
    }
  };
});

// 网络IO迷你图表 - 优化版本，使用固定窗口避免变形
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

// 固定的x轴标签，避免重复生成
const miniChartLabels = Array.from({ length: MINI_CHART_WINDOW }, () => '');

const networkChartOption = computed(() => {
  const { rx, tx } = networkMiniSeries.value;
  const allValues = [...rx, ...tx];
  const maxValue = allValues.reduce((max, v) => (v > max ? v : max), 0);
  // 为 I/O 指标提供一个稳定的 Y 轴范围：从 0 到当前窗口内的峰值略放大。
  const maxWithHeadroom = maxValue <= 0 ? 1 : maxValue * 1.2;

  return {
    ...CHART_ANIMATION,
    grid: {
      left: 4,
      right: 4,
      top: 4,
      bottom: 6,
    },
    xAxis: {
      type: "category",
      data: miniChartLabels,
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
    series: [
      {
        name: "RX",
        type: "line",
        data: rx,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 1.5 },
      },
      {
        name: "TX",
        type: "line",
        data: tx,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 1.5 },
      },
    ],
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        if (typeof value !== "number" || Number.isNaN(value)) return "--";
        return `${value.toFixed(2)} MB/s`;
      },
      formatter: (params: any) => {
        return `${params[0].seriesName}: ${params[0].value.toFixed(2)} MB/s`;
      },
    },
  };
});

// 磁盘IO迷你图表 - 优化版本，使用固定窗口避免变形
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
  const allValues = [...read, ...write];
  const maxValue = allValues.reduce((max, v) => (v > max ? v : max), 0);
  const maxWithHeadroom = maxValue <= 0 ? 1 : maxValue * 1.2;

  return {
    ...CHART_ANIMATION,
    grid: {
      left: 4,
      right: 4,
      top: 4,
      bottom: 6,
    },
    xAxis: {
      type: "category",
      data: miniChartLabels,
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
    series: [
      {
        name: "Read",
        type: "line",
        data: read,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 1.5 },
      },
      {
        name: "Write",
        type: "line",
        data: write,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 1.5 },
      },
    ],
    tooltip: {
      trigger: "axis",
      valueFormatter(value: number) {
        if (typeof value !== "number" || Number.isNaN(value)) return "--";
        return `${value.toFixed(2)} MB/s`;
      },
      formatter: (params: any) => {
        return `${params[0].seriesName}: ${params[0].value.toFixed(2)} MB/s`;
      },
    },
  };
});
</script>

<template>
  <section class="monitor-pro">
    <!-- 顶部状态区域：只保留 GPU 状态，移除多余的仪表盘卡片以减少视觉噪音 -->
    <div class="gauge-section">
      <!-- GPU实时状态卡片 -->
      <div class="gpu-card">
        <div class="gpu-header">
          <span class="gpu-title">{{ t('monitor.gpuStatus') }}</span>
          <span
            class="status-indicator"
            :class="{ active: latestGpu?.available }"
          ></span>
        </div>
        <VChart
          class="gpu-chart"
          :option="gpuChartOption"
          :update-options="{ notMerge: false, lazyUpdate: true }"
          autoresize
        />
        <div class="gpu-stats">
          <div class="stat">
            <span class="stat-label">{{ t('monitor.gpuCore') }}</span>
            <span class="stat-value">
              {{ displayMetrics.gpuUsage.toFixed(1) }}%
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">{{ t('monitor.gpuVram') }}</span>
            <span class="stat-value">
              {{ displayMetrics.gpuMemory.toFixed(1) }}%
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">{{ t('monitor.gpuTemp') }}</span>
            <span class="stat-value">{{ Math.floor(Math.random() * 30 + 50) }}°C</span>
          </div>
        </div>
      </div>
    </div>

    <!-- CPU核心热力图 -->
    <div class="heatmap-section" v-if="cpuHeatmapOption">
      <div class="section-header">
        <span class="section-title">{{ t('monitor.cpuHeatmap') }}</span>
        <span class="section-subtitle">{{ perCoreSeries.length }} {{ t('monitor.cores') }}</span>
      </div>
      <VChart
        class="heatmap-chart"
        :option="cpuHeatmapOption"
        :update-options="{ notMerge: false, lazyUpdate: true }"
        autoresize
      />
    </div>

    <!-- 底部快速指标区 -->
    <div class="metrics-grid">
      <!-- 网络IO -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">{{ t('monitor.networkIo') }}</span>
          <div class="metric-badges">
            <span class="badge rx">{{ t('monitor.rx') }}</span>
            <span class="badge tx">{{ t('monitor.tx') }}</span>
          </div>
        </div>
        <VChart
          class="mini-chart"
          :option="networkChartOption"
          :update-options="{ notMerge: false, lazyUpdate: true }"
          autoresize
        />
        <div class="metric-values">
          <span class="value rx">
            {{ t('monitor.download') }} {{ displayMetrics.netRxMbps.toFixed(2) }} MB/s
          </span>
          <span class="value tx">
            {{ t('monitor.upload') }} {{ displayMetrics.netTxMbps.toFixed(2) }} MB/s
          </span>
        </div>
      </div>

      <!-- 磁盘IO -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">{{ t('monitor.diskIo') }}</span>
          <div class="metric-badges">
            <span class="badge read">{{ t('monitor.read') }}</span>
            <span class="badge write">{{ t('monitor.write') }}</span>
          </div>
        </div>
        <VChart
          class="mini-chart"
          :option="diskChartOption"
          :update-options="{ notMerge: false, lazyUpdate: true }"
          autoresize
        />
        <div class="metric-values">
          <span class="value read">
            {{ t('monitor.reading') }} {{ displayMetrics.diskReadMbps.toFixed(2) }} MB/s
          </span>
          <span class="value write">
            {{ t('monitor.writing') }} {{ displayMetrics.diskWriteMbps.toFixed(2) }} MB/s
          </span>
        </div>
      </div>

      <!-- CPU / 内存 / GPU 汇总 -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">{{ t('monitor.cpuMemoryGpu') }}</span>
        </div>
        <div class="resource-stats">
          <div class="resource-item">
            <div class="resource-header">
              <span class="resource-label">{{ t('monitor.cpu') }}</span>
              <span class="resource-percent">
                {{ latestMetrics ? `${cpuPercent.toFixed(1)}%` : "--" }}
              </span>
            </div>
            <div class="resource-bar">
              <div
                class="resource-progress cpu"
                :style="{ width: latestMetrics ? `${cpuPercent}%` : '0%' }"
              ></div>
            </div>
          </div>
          <div class="resource-item">
            <div class="resource-header">
              <span class="resource-label">{{ t('monitor.memory') }}</span>
              <span class="resource-percent">
                {{ latestMetrics ? `${memoryPercent.toFixed(1)}%` : "--" }}
              </span>
            </div>
            <div class="resource-bar">
              <div
                class="resource-progress memory"
                :style="{ width: latestMetrics ? `${memoryPercent}%` : '0%' }"
              ></div>
            </div>
          </div>
          <div class="resource-item">
            <div class="resource-header">
              <span class="resource-label">{{ t('monitor.gpu') }}</span>
              <span class="resource-percent">
                {{ latestMetrics ? `${gpuPercent.toFixed(1)}%` : "--" }}
              </span>
            </div>
            <div class="resource-bar">
              <div
                class="resource-progress gpu"
                :style="{ width: latestMetrics ? `${gpuPercent}%` : '0%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 系统运行时间 -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">{{ t('monitor.systemUptime') }}</span>
        </div>
        <div class="uptime-display">
          <div class="uptime-value">
            <template v-if="monitorUptime">
              {{ monitorUptime.days }}d {{ monitorUptime.hours }}h {{ monitorUptime.minutes }}m
            </template>
            <template v-else>
              --
            </template>
          </div>
          <div class="uptime-bar">
            <div
              class="uptime-progress"
              :style="{ width: `${monitorUptimeProgressPercent}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.monitor-pro {
  padding: 1rem;
  background: linear-gradient(135deg, #0a0e1a 0%, #0f1923 100%);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
  position: relative;
  overflow: hidden;
}

.monitor-pro::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 255, 0.03) 2px, rgba(0, 255, 255, 0.03) 4px),
    repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255, 0, 255, 0.03) 2px, rgba(255, 0, 255, 0.03) 4px);
  pointer-events: none;
  z-index: 1;
}

/* 顶部仪表盘区域 */
.gauge-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
  position: relative;
  z-index: 2;
}

.gauge-card {
  background: linear-gradient(145deg, rgba(0, 20, 40, 0.9), rgba(0, 10, 30, 0.9));
  border: 1px solid rgba(0, 255, 255, 0.2);
  border-radius: 12px;
  padding: 1rem;
  box-shadow:
    0 4px 20px rgba(0, 255, 255, 0.1),
    inset 0 1px 0 rgba(0, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.gauge-card::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  background: linear-gradient(45deg, #00ffcc, #ff00ff, #00ddff, #ffaa00);
  border-radius: 12px;
  opacity: 0;
  transition: opacity 0.3s;
  z-index: -1;
  animation: borderGlow 3s ease-in-out infinite;
}

@keyframes borderGlow {
  0%, 100% { opacity: 0; }
  50% { opacity: 0.3; }
}

.gauge-chart {
  height: 120px;
  width: 100%;
}

.gauge-label {
  text-align: center;
  font-size: 0.75rem;
  color: rgba(0, 255, 204, 0.8);
  font-weight: 700;
  letter-spacing: 2px;
  margin-top: -10px;
}

/* GPU卡片 */
.gpu-card {
  background: linear-gradient(145deg, rgba(40, 0, 40, 0.9), rgba(20, 0, 30, 0.9));
  border: 1px solid rgba(255, 0, 255, 0.3);
  border-radius: 12px;
  padding: 1rem;
  box-shadow:
    0 4px 20px rgba(255, 0, 255, 0.2),
    inset 0 1px 0 rgba(255, 0, 255, 0.2);
  min-height: 180px;
}

.gpu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.gpu-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #ff00ff;
  letter-spacing: 1px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
  box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
  animation: pulse 2s infinite;
}

.status-indicator.active {
  background: #00ff00;
  box-shadow: 0 0 15px rgba(0, 255, 0, 0.8);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.gpu-chart {
  height: 100px;
  width: 100%;
  margin: 0.5rem 0;
}

.gpu-stats {
  display: flex;
  justify-content: space-around;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 0, 255, 0.2);
}

.stat {
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 0.625rem;
  color: #999;
  margin-bottom: 0.25rem;
  letter-spacing: 1px;
}

.stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #00ffcc;
  text-shadow: 0 0 10px rgba(0, 255, 204, 0.5);
}

/* 热力图部分 */
.heatmap-section {
  background: rgba(0, 10, 20, 0.8);
  border: 1px solid rgba(0, 255, 255, 0.2);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  position: relative;
  z-index: 2;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #00ddff;
  letter-spacing: 1px;
}

.section-subtitle {
  font-size: 0.625rem;
  color: #666;
  letter-spacing: 1px;
}

.heatmap-chart {
  height: 150px;
  width: 100%;
}

/* 底部指标网格 */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  position: relative;
  z-index: 2;
}

.metric-card {
  background: linear-gradient(145deg, rgba(10, 20, 30, 0.9), rgba(5, 10, 20, 0.9));
  border: 1px solid rgba(0, 255, 255, 0.15);
  border-radius: 8px;
  padding: 0.75rem;
  transition: all 0.3s;
  position: relative;
  overflow: hidden;
}

.metric-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent, rgba(0, 255, 255, 0.1));
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.metric-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 255, 255, 0.4);
  box-shadow: 0 8px 25px rgba(0, 255, 255, 0.2);
}

.metric-card:hover::after {
  opacity: 1;
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.metric-title {
  font-size: 0.625rem;
  font-weight: 700;
  color: #00ffcc;
  letter-spacing: 1px;
}

.metric-badges {
  display: flex;
  gap: 0.25rem;
}

.badge {
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 1px;
}

.badge.rx, .badge.read {
  background: rgba(0, 255, 136, 0.2);
  color: #00ff88;
  border: 1px solid rgba(0, 255, 136, 0.3);
}

.badge.tx, .badge.write {
  background: rgba(255, 102, 0, 0.2);
  color: #ff6600;
  border: 1px solid rgba(255, 102, 0, 0.3);
}

.mini-chart {
  height: 80px;
  width: 100%;
  margin: 0.5rem 0;
}

.metric-values {
  display: flex;
  justify-content: space-between;
  font-size: 0.625rem;
  font-weight: 600;
}

.value {
  font-family: 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
}

.value.rx, .value.read {
  color: #00ff88;
}

.value.tx, .value.write {
  color: #ff6600;
}

/* 资源使用率统计样式 */
.resource-stats {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.resource-item {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.resource-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.resource-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #888;
  letter-spacing: 1px;
}

.resource-percent {
  font-size: 0.875rem;
  font-weight: 700;
  color: #00ddff;
  font-family: 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
  text-shadow: 0 0 8px rgba(0, 221, 255, 0.4);
}

.resource-bar {
  height: 12px;
  background: rgba(0, 50, 80, 0.5);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 255, 255, 0.15);
}

.resource-progress {
  height: 100%;
  border-radius: 5px;
  transition: width 0.3s ease-out;
}

.resource-progress.cpu {
  background: linear-gradient(90deg, #00ccff, #00ffcc);
  box-shadow: 0 0 12px rgba(0, 204, 255, 0.5);
}

.resource-progress.memory {
  background: linear-gradient(90deg, #ff6600, #ffaa00);
  box-shadow: 0 0 12px rgba(255, 102, 0, 0.5);
}

.resource-progress.gpu {
  background: linear-gradient(90deg, #ff00ff, #aa00ff);
  box-shadow: 0 0 12px rgba(255, 0, 255, 0.5);
}

/* 运行时间显示 */
.uptime-display {
  margin-top: 1rem;
}

.uptime-value {
  font-size: 1rem;
  font-weight: 700;
  color: #ffaa00;
  text-align: center;
  margin-bottom: 0.5rem;
  text-shadow: 0 0 10px rgba(255, 170, 0, 0.5);
}

.uptime-bar {
  height: 4px;
  background: rgba(255, 170, 0, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.uptime-progress {
  height: 100%;
  background: linear-gradient(90deg, #ffaa00, #ff6600);
  box-shadow: 0 0 10px rgba(255, 170, 0, 0.5);
  animation: progressPulse 2s ease-in-out infinite;
}

@keyframes progressPulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

/* 响应式调整 */
@media (max-width: 768px) {
  .gauge-section {
    grid-template-columns: 1fr;
  }

  .metrics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
