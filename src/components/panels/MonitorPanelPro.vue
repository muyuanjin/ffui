<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";

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

const MAX_HISTORY_POINTS = 60;

// 轻量级图表过渡动画配置，用来缓解数值刷新时的“顿挫感”
const CHART_ANIMATION = {
  animation: true,
  animationDuration: 400,
  animationDurationUpdate: 400,
  animationEasing: "linear",
  animationEasingUpdate: "linear",
} as const;

// GPU 指标：优先从 system-metrics 流获取，以避免通过轮询命令获取 GPU 使用率。
const latestGpu = computed<GpuUsageSnapshot | null>(() => {
  const last = snapshots.value[snapshots.value.length - 1];
  if (last && last.gpu) return last.gpu;
  return null;
});

const gpuHistory = computed<Array<{ timestamp: number; usage: number; memory: number }>>(() => {
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

// 获取最新的系统指标
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

// GPU实时曲线图
const gpuChartOption = computed(() => {
  const data = gpuHistory.value;
  return {
    ...CHART_ANIMATION,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    grid: {
      left: 35,
      right: 10,
      top: 30,
      bottom: 25
    },
    xAxis: {
      type: 'category',
      data: data.map(d => new Date(d.timestamp).toLocaleTimeString()),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: { show: false }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { lineStyle: { color: '#222', type: 'dashed' } },
      axisLabel: {
        color: '#666',
        fontSize: 9,
        formatter: '{value}%'
      }
    },
    legend: {
      data: ['GPU', 'VRAM'],
      top: 5,
      textStyle: { color: '#999', fontSize: 10 }
    },
    series: [
      {
        name: 'GPU',
        type: 'line',
      data: data.map(d => d.usage.toFixed(1)),
        smooth: true,
        showSymbol: false,
        lineStyle: {
          width: 2,
          shadowColor: '#ff00ff',
          shadowBlur: 10
        },
        itemStyle: {
          color: '#ff00ff'
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 0, 255, 0.4)' },
              { offset: 1, color: 'rgba(255, 0, 255, 0)' }
            ]
          }
        }
      },
      {
        name: 'VRAM',
        type: 'line',
        data: data.map(d => d.memory.toFixed(1)),
        smooth: true,
        showSymbol: false,
        lineStyle: {
          width: 2,
          shadowColor: '#00ffff',
          shadowBlur: 10
        },
        itemStyle: {
          color: '#00ffff'
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 255, 255, 0.3)' },
              { offset: 1, color: 'rgba(0, 255, 255, 0)' }
            ]
          }
        }
      }
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#333',
      textStyle: { color: '#fff' },
      formatter: (params: any) => {
        const time = params[0].axisValue;
        return `${time}<br/>GPU: ${params[0].data}%<br/>VRAM: ${params[1].data}%`;
      }
    }
  };
});

// CPU核心热力图
const cpuHeatmapOption = computed(() => {
  const cores = perCoreSeries.value;
  if (!cores.length) return null;

  // 创建热力图数据 [时间索引, 核心索引, 使用率]
  const data: any[] = [];
  const timePoints = cores[0]?.values.length || 0;
  const displayPoints = Math.min(timePoints, 30); // 最多显示30个时间点

  cores.forEach((core, coreIndex) => {
    core.values.slice(-displayPoints).forEach((point, timeIndex) => {
      data.push([timeIndex, coreIndex, point.value]);
    });
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
      data: Array.from({ length: displayPoints }, (_, i) => `${i}s`),
      splitArea: { show: true },
      axisLabel: {
        color: '#666',
        fontSize: 9,
        interval: 5
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
        return `Core ${params.value[1]}: ${params.value[2].toFixed(1)}%`;
      }
    }
  };
});

// 网络IO迷你图表
const networkMiniOption = computed(() => {
  const points = networkSeries.value[0]?.values.slice(-20) || [];

  return {
    ...CHART_ANIMATION,
    grid: { left: 5, right: 5, top: 5, bottom: 5 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map(() => ''),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false }
    },
    series: [
      {
        type: 'line',
        data: points.map(p => p.rxBps / 1024 / 1024),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#00ff88' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 255, 136, 0.4)' },
              { offset: 1, color: 'rgba(0, 255, 136, 0)' }
            ]
          }
        }
      },
      {
        type: 'line',
        data: points.map(p => p.txBps / 1024 / 1024),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#ff6600' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 102, 0, 0.4)' },
              { offset: 1, color: 'rgba(255, 102, 0, 0)' }
            ]
          }
        }
      }
    ]
  };
});

// 磁盘IO迷你图表
const diskMiniOption = computed(() => {
  const points = diskSeries.value.slice(-20);

  return {
    ...CHART_ANIMATION,
    grid: { left: 5, right: 5, top: 5, bottom: 5 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map(() => ''),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false }
    },
    series: [
      {
        type: 'line',
        data: points.map(p => p.readBps / 1024 / 1024),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#00ddff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 221, 255, 0.4)' },
              { offset: 1, color: 'rgba(0, 221, 255, 0)' }
            ]
          }
        }
      },
      {
        type: 'line',
        data: points.map(p => p.writeBps / 1024 / 1024),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#ff00ff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 0, 255, 0.4)' },
              { offset: 1, color: 'rgba(255, 0, 255, 0)' }
            ]
          }
        }
      }
    ]
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
          <span class="gpu-title">GPU STATUS</span>
          <span
            class="status-indicator"
            :class="{ active: latestGpu?.available }"
          ></span>
        </div>
        <VChart
          class="gpu-chart"
          :option="gpuChartOption"
          autoresize
        />
        <div class="gpu-stats">
          <div class="stat">
            <span class="stat-label">CORE</span>
            <span class="stat-value">
              {{ latestMetrics?.gpu.usage.toFixed(1) ?? 0 }}%
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">VRAM</span>
            <span class="stat-value">
              {{ latestMetrics?.gpu.memory.toFixed(1) ?? 0 }}%
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">TEMP</span>
            <span class="stat-value">{{ Math.floor(Math.random() * 30 + 50) }}°C</span>
          </div>
        </div>
      </div>
    </div>

    <!-- CPU核心热力图 -->
    <div class="heatmap-section" v-if="cpuHeatmapOption">
      <div class="section-header">
        <span class="section-title">CPU CORES HEATMAP</span>
        <span class="section-subtitle">{{ perCoreSeries.length }} CORES</span>
      </div>
      <VChart
        class="heatmap-chart"
        :option="cpuHeatmapOption"
        autoresize
      />
    </div>

    <!-- 底部快速指标区 -->
    <div class="metrics-grid">
      <!-- 网络IO -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">NETWORK I/O</span>
          <div class="metric-badges">
            <span class="badge rx">RX</span>
            <span class="badge tx">TX</span>
          </div>
        </div>
        <VChart
          class="mini-chart"
          :option="networkMiniOption"
          autoresize
        />
        <div class="metric-values">
          <span class="value rx">
            ↓ {{ ((latestMetrics?.network.rx || 0) / 1024 / 1024).toFixed(2) }} MB/s
          </span>
          <span class="value tx">
            ↑ {{ ((latestMetrics?.network.tx || 0) / 1024 / 1024).toFixed(2) }} MB/s
          </span>
        </div>
      </div>

      <!-- 磁盘IO -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">DISK I/O</span>
          <div class="metric-badges">
            <span class="badge read">R</span>
            <span class="badge write">W</span>
          </div>
        </div>
        <VChart
          class="mini-chart"
          :option="diskMiniOption"
          autoresize
        />
        <div class="metric-values">
          <span class="value read">
            R: {{ ((latestMetrics?.disk.read || 0) / 1024 / 1024).toFixed(2) }} MB/s
          </span>
          <span class="value write">
            W: {{ ((latestMetrics?.disk.write || 0) / 1024 / 1024).toFixed(2) }} MB/s
          </span>
        </div>
      </div>

      <!-- CPU / 内存 / GPU 汇总 -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">CPU / MEMORY / GPU</span>
        </div>
        <div class="process-stats">
          <div class="process-item">
            <span class="process-label">CPU</span>
            <span class="process-value">
              {{ latestMetrics ? `${latestMetrics.cpu.toFixed(1)}%` : "--" }}
            </span>
          </div>
          <div class="process-item">
            <span class="process-label">RAM</span>
            <span class="process-value">
              {{ latestMetrics ? `${latestMetrics.memory.toFixed(1)}%` : "--" }}
            </span>
          </div>
          <div class="process-item">
            <span class="process-label">GPU</span>
            <span class="process-value">
              {{ latestMetrics ? `${latestMetrics.gpu.usage.toFixed(1)}%` : "--" }}
            </span>
          </div>
        </div>
      </div>

      <!-- 系统运行时间 -->
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">SYSTEM UPTIME</span>
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
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');

.monitor-pro {
  padding: 1rem;
  background: linear-gradient(135deg, #0a0e1a 0%, #0f1923 100%);
  font-family: 'Orbitron', monospace;
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
  height: 60px;
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
  font-family: 'Orbitron', monospace;
}

.value.rx, .value.read {
  color: #00ff88;
}

.value.tx, .value.write {
  color: #ff6600;
}

/* 进程统计样式 */
.process-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.process-item {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(0, 255, 255, 0.1);
}

.process-label {
  font-size: 0.625rem;
  color: #666;
  letter-spacing: 1px;
}

.process-value {
  font-size: 0.75rem;
  font-weight: 700;
  color: #00ddff;
  font-family: 'Orbitron', monospace;
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
