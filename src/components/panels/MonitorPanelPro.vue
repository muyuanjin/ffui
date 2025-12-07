<script setup lang="ts">
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useMonitorPanelProState } from "@/composables/monitor";
import { GpuCard, CpuHeatmap, ResourceBar } from "./monitor";
import { useI18n } from "vue-i18n";

defineProps<{
  cpuSnapshot?: CpuUsageSnapshot | null;
  gpuSnapshot?: GpuUsageSnapshot | null;
}>();

const { t } = useI18n();

const {
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
  monitorUptime,
  monitorUptimeProgressPercent,
} = useMonitorPanelProState();
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
        <div class="metric-header">
          <span class="metric-title">CPU / MEMORY / GPU</span>
        </div>
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

<style scoped src="./MonitorPanelPro.css"></style>
