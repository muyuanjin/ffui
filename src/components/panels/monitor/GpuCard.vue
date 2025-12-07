<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { GpuUsageSnapshot } from "@/types";
import { useI18n } from "vue-i18n";

interface Props {
  /** GPU 数据快照 */
  gpu: GpuUsageSnapshot | null;
  /** ECharts 图表配置 */
  chartOption: any;
  /** GPU 使用率（百分比） */
  gpuUsage: number;
  /** GPU 显存使用率（百分比） */
  gpuMemory: number;
}

defineProps<Props>();
const { t } = useI18n();

// GPU 温度（临时模拟数据，实际应从 props 传入）
const gpuTemp = computed(() => Math.floor(Math.random() * 30 + 50));
</script>

<template>
  <div class="gpu-card">
    <div class="gpu-header">
      <span class="gpu-title">{{ t('monitor.gpuStatus') }}</span>
      <span
        class="status-indicator"
        :class="{ active: gpu?.available }"
      ></span>
    </div>
    <VChart
      class="gpu-chart"
      :option="chartOption"
      :update-options="{ notMerge: false, lazyUpdate: true }"
      autoresize
    />
    <div class="gpu-stats">
      <div class="stat">
        <span class="stat-label">{{ t('monitor.gpuCore') }}</span>
        <span class="stat-value">
          {{ gpuUsage.toFixed(1) }}%
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">{{ t('monitor.gpuVram') }}</span>
        <span class="stat-value">
          {{ gpuMemory.toFixed(1) }}%
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">{{ t('monitor.gpuTemp') }}</span>
        <span class="stat-value">{{ gpuTemp }}°C</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
</style>
