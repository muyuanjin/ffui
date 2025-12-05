# FFUI

基于 Tauri 2 + Vue 3 的 FFmpeg 桌面 UI。

## 开发环境

- [VS Code](https://code.visualstudio.com/)
- 插件：Vue - Official、Tauri、rust-analyzer

## 运行与构建

- `npm install` — 安装前端依赖与 Tauri CLI。
- `npm run dev` — 启动前端开发服务器（纯 Web，无 Tauri）。
- `npm run tauri dev` — 启动完整 Tauri 桌面应用。
- `npm run build` — 构建生产前端资源。

## 系统性能监控（System Performance Monitoring）

本项目内置“性能”面板，用于实时查看 CPU / 内存 / 磁盘 I/O / 网络 I/O 等指标。

### 后端采样配置（环境变量）

后端在 `src-tauri/src/system_metrics.rs` 中通过 `sysinfo` 采样系统指标，并通过
`system-metrics://update` 事件推送到前端。采样行为可通过以下环境变量控制：

- `FFUI_METRICS_INTERVAL_MS`  
  - 单位：毫秒  
  - 含义：有订阅者时的采样间隔。  
  - 默认：`1000`（1 秒）。

- `FFUI_METRICS_IDLE_INTERVAL_MS`  
  - 单位：毫秒  
  - 含义：无订阅者时后台空闲循环的休眠间隔（低频保活 / 几乎不工作）。  
  - 默认：`5000`（5 秒）。

- `FFUI_METRICS_HISTORY_CAPACITY`  
  - 单位：条  
  - 含义：后端环形缓冲区最多保留的快照数量。超过上限时丢弃最旧的数据。  
  - 默认：`600`（约 10 分钟历史，按 1 秒采样计）。

- `FFUI_METRICS_MAX_DISKS`  
  - 单位：个  
  - 含义：磁盘 I/O 指标保留的设备条目上限（当前实现聚合为 `total`，该值预留将来扩展）。  
  - 默认：`6`。

- `FFUI_METRICS_MAX_INTERFACES`  
  - 单位：个  
  - 含义：网络接口指标保留的网卡数量上限（按吞吐量排序后截断）。  
  - 默认：`6`。

### 前端性能面板

- 组合式函数：`useSystemMetrics`（`src/composables/useSystemMetrics.ts`）
  - 在 Tauri 环境下通过 `system-metrics://update` 订阅后端事件，并维护有界历史。
  - 在纯 Web / 测试环境下使用内置的模拟数据源，方便仅前端开发。
  - 默认前端历史长度为 `600` 条，可通过 `historyLimit` 选项在调用时覆盖。
  - 针对高核数主机仅渲染前 `32` 个核心序列，避免图表序列爆炸。

- 视图组件：`MonitorPanel.vue`（`src/components/panels/MonitorPanel.vue`）
  - CPU 总体利用率随时间曲线。
  - 多核心 CPU 时间序列（带滚动 legend）。
  - 内存占用曲线（GB）。
  - 磁盘 I/O（读写 MB/s）。
  - 网络 I/O（按网卡拆分的 RX/TX MB/s）。
  - NVIDIA GPU 使用率 / 显存使用率（基于 NVML，保持与旧接口兼容）。
