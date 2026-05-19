# Monitor Composables

This directory contains monitor-specific composables used by `src/components/panels/MonitorPanelPro.vue`.

## Current entry points

- `useChartDataBuffer.ts`
  - smoothing helpers and fixed-window buffers for chart series
- `useGpuMetrics.ts`
  - derives latest GPU snapshot and GPU history/series from monitor snapshots
- `useMonitorPanelProState.ts`
  - panel-level derived state for the monitor UI
- `useMonitorUptime.ts`
  - derives monitor uptime display state
- `useTranscodeActivityToday.ts`
  - derives the daily transcode activity heatmap view model

## Usage notes

- Import ECharts runtime registration through `@/lib/echarts`; do not import `echarts` directly.
- Use `useSystemMetrics` from `src/composables/useSystemMetrics.ts` as the backend-facing source of snapshots and subscriptions.
- Keep monitor-specific derivations in this directory rather than re-embedding them into `MonitorPanelPro.vue`.
