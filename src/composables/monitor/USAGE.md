# Monitor Composables 使用指南

本文档说明如何在 `MonitorPanelPro.vue` 中使用重构后的监控相关 composables。

## 已创建的 Composables

### 1. useChartDataBuffer.ts

**导出项：**
- `DEFAULT_SMOOTH_ALPHA` (常量)
- `MINI_CHART_WINDOW` (常量)
- `GPU_CHART_WINDOW` (常量)
- `smoothEma(values, alpha?)` (函数)
- `createFixedBuffer(data, windowSize?)` (函数)

**用途：** 数据平滑和固定窗口缓冲，用于优化图表显示效果。

### 2. useGpuMetrics.ts

**导出项：**
- `useGpuMetrics(snapshots)` (函数)

**返回值：**
- `latestGpu` - 最新的 GPU 快照
- `gpuHistory` - GPU 历史数据点
- `gpuUsageSeries` - 平滑后的 GPU 使用率序列
- `gpuMemorySeries` - 平滑后的 GPU 显存序列

**用途：** 管理 GPU 使用率和显存历史数据。

### 3. useMonitorUptime.ts

**导出项：**
- `useMonitorUptime(snapshots)` (函数)

**返回值：**
- `monitorUptime` - 监控在线时长对象 `{ days, hours, minutes, totalSeconds }`
- `monitorUptimeProgressPercent` - 在线时长进度百分比

**用途：** 计算监控面板自启动以来的运行时间。

## 在 MonitorPanelPro.vue 中使用示例

### 原始代码（行 1-96）：

```typescript
import { computed, ref, watch } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";
import { useI18n } from "vue-i18n";

const { snapshots, /* ... */ } = useSystemMetrics();

const MAX_HISTORY_POINTS = 60;
const DEFAULT_SMOOTH_ALPHA = 0.25;

function smoothEma(values: number[], alpha: number = DEFAULT_SMOOTH_ALPHA): number[] {
  // ... 实现代码
}

const MINI_CHART_WINDOW = 20;
const GPU_CHART_WINDOW = 40;

const createFixedBuffer = (data: number[], windowSize: number = MINI_CHART_WINDOW): number[] => {
  // ... 实现代码
};

// GPU 指标相关代码
const latestGpu = computed<GpuUsageSnapshot | null>(() => {
  // ... 实现代码
});

const gpuHistory = computed(() => {
  // ... 实现代码
});

const gpuUsageSeries = computed(() =>
  smoothEma(gpuHistory.value.map((p) => p.usage)),
);

const gpuMemorySeries = computed(() =>
  smoothEma(gpuHistory.value.map((p) => p.memory)),
);
```

### 重构后的代码：

```typescript
import { computed, ref, watch } from "vue";
import VChart from "vue-echarts";
import "echarts";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";
import { useSystemMetrics } from "@/composables";
import { useI18n } from "vue-i18n";

// 导入监控相关 composables
import {
  smoothEma,
  createFixedBuffer,
  MINI_CHART_WINDOW,
  GPU_CHART_WINDOW,
  useGpuMetrics,
  useMonitorUptime,
} from "@/composables/monitor";

const {
  snapshots,
  cpuTotalSeries,
  perCoreSeries,
  memorySeries,
  diskSeries,
  networkSeries,
} = useSystemMetrics();

const { t } = useI18n();

// 使用 GPU 指标 composable
const {
  latestGpu,
  gpuHistory,
  gpuUsageSeries,
  gpuMemorySeries,
} = useGpuMetrics(snapshots);

// 使用监控在线时长 composable
const {
  monitorUptime,
  monitorUptimeProgressPercent,
} = useMonitorUptime(snapshots);

// 其余代码保持不变...
```

## 需要替换的原始代码行

1. **删除行 42-66**：`smoothEma` 和 `createFixedBuffer` 函数定义
2. **删除行 68-96**：GPU 指标相关的 computed 属性
3. **删除行 173-193**：监控在线时长相关的 computed 属性
4. **添加导入**：在文件顶部导入新的 composables

## 导入路径

所有 composables 都可以通过以下路径导入：

```typescript
import {
  // 常量
  DEFAULT_SMOOTH_ALPHA,
  MINI_CHART_WINDOW,
  GPU_CHART_WINDOW,

  // 工具函数
  smoothEma,
  createFixedBuffer,

  // Composables
  useGpuMetrics,
  useMonitorUptime,
} from "@/composables/monitor";
```

或者单独导入：

```typescript
import { smoothEma, createFixedBuffer } from "@/composables/monitor/useChartDataBuffer";
import { useGpuMetrics } from "@/composables/monitor/useGpuMetrics";
import { useMonitorUptime } from "@/composables/monitor/useMonitorUptime";
```

## 优势

1. **代码复用**：这些 composables 可以在其他监控面板中复用
2. **关注点分离**：每个文件专注于一个特定功能
3. **易于测试**：独立的函数更容易编写单元测试
4. **可维护性**：修改某个功能时只需编辑对应的 composable 文件
5. **类型安全**：完整的 TypeScript 类型支持

## 完整的导出列表

### E:\RustWorkSpace\ffui\src\composables\monitor\index.ts

导出所有 monitor 相关的 composables：

- ✅ `DEFAULT_SMOOTH_ALPHA`
- ✅ `MINI_CHART_WINDOW`
- ✅ `GPU_CHART_WINDOW`
- ✅ `smoothEma()`
- ✅ `createFixedBuffer()`
- ✅ `useGpuMetrics()`
- ✅ `useMonitorUptime()`
