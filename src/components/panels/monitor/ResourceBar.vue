<script setup lang="ts">
import { computed } from "vue";

interface Props {
  /** 资源标签 */
  label: string;
  /** 使用率百分比（0-100） */
  percent: number;
  /** 资源类型（用于区分颜色） */
  type: 'cpu' | 'memory' | 'gpu';
  /** 是否显示数据 */
  hasData?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  hasData: true,
});

// 限制百分比在 0-100 范围内
const clampedPercent = computed(() => Math.max(0, Math.min(100, props.percent)));

// 格式化百分比显示
const displayPercent = computed(() =>
  props.hasData ? `${clampedPercent.value.toFixed(1)}%` : "--"
);

// 进度条宽度
const progressWidth = computed(() =>
  props.hasData ? `${clampedPercent.value}%` : '0%'
);
</script>

<template>
  <div class="resource-item">
    <div class="resource-header">
      <span class="resource-label">{{ label }}</span>
      <span class="resource-percent">
        {{ displayPercent }}
      </span>
    </div>
    <div class="resource-bar">
      <div
        class="resource-progress"
        :class="type"
        :style="{ width: progressWidth }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
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
</style>
