import { computed, unref } from "vue";
import type { Ref, ComputedRef } from "vue";
import type { FFmpegPreset, TranscodeJob, QueueProgressStyle, QueueMode, QueueViewMode } from "@/types";
import type {
  QueueFilterKind,
  QueueFilterStatus,
  QueueSortDirection,
  QueueSortField,
  QueueListItem,
} from "@/composables";

interface QueuePanelBindingsInput {
  queueJobsForDisplay: Ref<TranscodeJob[]> | ComputedRef<TranscodeJob[]>;
  visibleQueueItems: Ref<QueueListItem[]> | ComputedRef<QueueListItem[]>;
  iconViewItems: Ref<QueueListItem[]> | ComputedRef<QueueListItem[]>;
  queueModeProcessingJobs: Ref<TranscodeJob[]> | ComputedRef<TranscodeJob[]>;
  queueModeWaitingItems: Ref<QueueListItem[]> | ComputedRef<QueueListItem[]>;
  queueModeWaitingBatchIds: Ref<Set<string>> | ComputedRef<Set<string>>;
  presets: Ref<FFmpegPreset[]>;
  queueViewMode: Ref<QueueViewMode>;
  ffmpegResolvedPath: Ref<string | null> | ComputedRef<string | null>;
  queueProgressStyleModel: Ref<QueueProgressStyle>;
  queueMode: Ref<QueueMode>;
  isIconViewMode: Ref<boolean>;
  iconViewSize: Ref<"small" | "medium" | "large">;
  iconGridClass: Ref<string>;
  queueRowVariant: Ref<"detail" | "compact">;
  progressUpdateIntervalMs: Ref<number>;
  hasSmartScanBatches: Ref<boolean>;
  activeStatusFilters: Ref<Set<QueueFilterStatus>>;
  activeTypeFilters: Ref<Set<QueueFilterKind>>;
  filterText: Ref<string>;
  filterUseRegex: Ref<boolean>;
  filterRegexError: Ref<string | null>;
  sortPrimary: Ref<QueueSortField>;
  sortPrimaryDirection: Ref<QueueSortDirection>;
  hasSelection: Ref<boolean>;
  hasActiveFilters: Ref<boolean>;
  selectedJobIds: Ref<Set<string>>;
  expandedBatchIds: Ref<Set<string>>;
  /** 排序比较函数，用于对批次子任务进行排序 */
  sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number;
}

export const createQueuePanelProps = (input: QueuePanelBindingsInput) =>
  computed(() => ({
    queueJobsForDisplay: unref(input.queueJobsForDisplay),
    visibleQueueItems: unref(input.visibleQueueItems),
    iconViewItems: unref(input.iconViewItems),
    queueModeProcessingJobs: unref(input.queueModeProcessingJobs),
    queueModeWaitingItems: unref(input.queueModeWaitingItems),
    queueModeWaitingBatchIds: unref(input.queueModeWaitingBatchIds),
    presets: unref(input.presets),
    queueViewMode: input.queueViewMode.value,
    ffmpegResolvedPath: unref(input.ffmpegResolvedPath),
    queueProgressStyle: input.queueProgressStyleModel.value,
    queueMode: input.queueMode.value,
    isIconViewMode: input.isIconViewMode.value,
    iconViewSize: input.iconViewSize.value,
    iconGridClass: input.iconGridClass.value,
    queueRowVariant: input.queueRowVariant.value,
    progressUpdateIntervalMs: unref(input.progressUpdateIntervalMs),
    hasSmartScanBatches: input.hasSmartScanBatches.value,
    activeStatusFilters: input.activeStatusFilters.value,
    activeTypeFilters: input.activeTypeFilters.value,
    filterText: input.filterText.value,
    filterUseRegex: input.filterUseRegex.value,
    filterRegexError: input.filterRegexError.value,
    sortPrimary: input.sortPrimary.value,
    sortPrimaryDirection: input.sortPrimaryDirection.value,
    hasSelection: input.hasSelection.value,
    hasActiveFilters: input.hasActiveFilters.value,
    selectedJobIds: input.selectedJobIds.value,
    selectedCount: input.selectedJobIds.value?.size ?? 0,
    expandedBatchIds: input.expandedBatchIds.value,
    sortCompareFn: input.sortCompareFn,
  }));
