// Composables index file for easy imports
// Usage: import { useJobLog, useQueueFiltering, ... } from '@/composables'

export { useJobLog } from "./useJobLog";
export type { LogLineKind, LogLineEntry, UseJobLogOptions, UseJobLogReturn } from "./useJobLog";

export { useQueueFiltering } from "./useQueueFiltering";
export type {
  QueueFilterStatus,
  QueueFilterKind,
  QueueSortField,
  QueueSortDirection,
  QueueListItem,
  UseQueueFilteringOptions,
  UseQueueFilteringReturn,
} from "./queue/useQueueFiltering.types";

export { useJobProgress } from "./useJobProgress";
export type { UseJobProgressOptions, UseJobProgressReturn } from "./useJobProgress";

export { useQueueOperations } from "./useQueueOperations";
export type { UseQueueOperationsOptions, UseQueueOperationsReturn } from "./useQueueOperations";

export { useSmartScan } from "./useSmartScan";
export type {
  SmartScanBatchMeta,
  SmartScanBatchSnapshot,
  UseSmartScanOptions,
  UseSmartScanReturn,
} from "./useSmartScan";

export { usePresetManagement } from "./usePresetManagement";
export type { UsePresetManagementOptions, UsePresetManagementReturn } from "./usePresetManagement";

export { useFileInput } from "./useFileInput";
export type { UseFileInputOptions, UseFileInputReturn } from "./useFileInput";

export { useAppSettings } from "./useAppSettings";
export type { UseAppSettingsOptions, UseAppSettingsReturn } from "./useAppSettings";

export { useWindowControls } from "./useWindowControls";

export { useDialogManager } from "./useDialogManager";

export { useDragAndDrop } from "./useDragAndDrop";
export type { UseDragAndDropOptions } from "./useDragAndDrop";

export { useMonitoring } from "./useMonitoring";
export type { UseMonitoringOptions } from "./useMonitoring";

export { useSystemMetrics } from "./useSystemMetrics";
export type {
  UseSystemMetricsOptions,
  UseSystemMetricsReturn,
  CoreSeries,
  DiskPoint,
  MemoryPoint,
  NetworkSeries,
  TimePoint,
} from "./useSystemMetrics";

export { usePresetEditor } from "./usePresetEditor";
export type { PresetEditorState, UsePresetEditorOptions, UsePresetEditorReturn } from "./usePresetEditor";

// Re-export commonly used helper functions
export {
  classifyLogLine,
  logLineClass,
  highlightFfmpegProgressLogLine,
  renderHighlightedLogLine,
  parseStructuredProgressPair,
  flushStructuredProgressBlock,
  parseAndHighlightLog,
} from "./useJobLog";

export { comparePrimitive, getJobSortValue, compareJobsByField } from "./queue/filtering-utils";

export { normalizedJobProgressForAggregate, taskbarJobWeightForAggregate } from "./useJobProgress";
