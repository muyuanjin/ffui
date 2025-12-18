<script setup lang="ts">
import VChart from "vue-echarts";
import "echarts";
import { useI18n } from "vue-i18n";

interface Props {
  /** ECharts 热力图配置 */
  chartOption: any;
  /** CPU 核心数量 */
  coreCount: number;
}

defineProps<Props>();
const { t } = useI18n();
</script>

<template>
  <div class="heatmap-section" v-if="chartOption">
    <div class="section-header">
      <span class="section-title">{{ t("monitor.cpuHeatmap") }}</span>
      <span class="section-subtitle">{{ coreCount }} {{ t("monitor.cores") }}</span>
    </div>
    <VChart
      class="heatmap-chart"
      :option="chartOption"
      :update-options="{ notMerge: false, lazyUpdate: true }"
      autoresize
    />
  </div>
</template>

<style scoped>
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
</style>
