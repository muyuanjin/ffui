<script setup lang="ts">
import { computed, ref, watch } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";
import { smoothEma, createFixedBuffer, MINI_CHART_WINDOW, GPU_CHART_WINDOW, useGpuMetrics, useMonitorUptime } from '@/composables/monitor';
import { GpuCard, CpuHeatmap, ResourceBar } from './monitor';
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

// 对于实时监控场景，ECharts 自带的补间动画在高频刷新下容易出现"顿挫"和形状抖动，
// 尤其是在采样间隔远小于 animationDurationUpdate 时，动画会不断被打断重启。
// 这里统一关闭图表层面的动画，只依赖较高的采样频率与前端数值插值来获得流畅视觉效果。
const CHART_ANIMATION = {
  animation: false,
  animationDuration: 0,
  animationDurationUpdate: 0,
} as const;

// 使用 GPU 指标 composable
const { latestGpu, gpuUsageSeries, gpuMemorySeries } = useGpuMetrics(snapshots);

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

// 使用监控在线时长 composable
const { monitorUptime, monitorUptimeProgressPercent } = useMonitorUptime(snapshots);

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
      <GpuCard
        :gpu="latestGpu"
        :chart-option="gpuChartOption"
        :gpu-usage="displayMetrics.gpuUsage"
        :gpu-memory="displayMetrics.gpuMemory"
      />
    </div>

    <!-- CPU核心热力图 -->
    <CpuHeatmap
      v-if="cpuHeatmapOption"
      :chart-option="cpuHeatmapOption"
      :core-count="perCoreSeries.length"
    />

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
        <div class="resource-stats">
          <ResourceBar
            :label="t('monitor.cpu')"
            :percent="cpuPercent"
            type="cpu"
            :has-data="!!latestMetrics"
          />
          <ResourceBar
            :label="t('monitor.memory')"
            :percent="memoryPercent"
            type="memory"
            :has-data="!!latestMetrics"
          />
          <ResourceBar
            :label="t('monitor.gpu')"
            :percent="gpuPercent"
            type="gpu"
            :has-data="!!latestMetrics"
          />
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

/* 网络IO迷你图表样式 */
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
