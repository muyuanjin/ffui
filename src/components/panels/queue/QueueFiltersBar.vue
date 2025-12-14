<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import type {
  QueueFilterStatus,
  QueueFilterKind,
  QueueSortField,
  QueueSortDirection,
} from "@/composables";
import type { QueueMode } from "@/types";
import QueueFiltersPanel from "./QueueFiltersPanel.vue";
import { ArrowDownUp, ArrowUpDown, Filter, ListOrdered, ChevronUp, X } from "lucide-vue-next";
import QueueSelectionBar from "./QueueSelectionBar.vue";

const props = defineProps<{
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
  sortPrimary: QueueSortField;
  sortPrimaryDirection: QueueSortDirection;
  sortSecondary: QueueSortField;
  sortSecondaryDirection: QueueSortDirection;
  hasActiveFilters: boolean;
  hasSelection: boolean;
  selectedCount: number;
  hasPrimarySortTies: boolean;
  queueMode: QueueMode;
  visibleCount: number;
  totalCount: number;
  /** 是否固定选择操作栏（即使没有选中项也显示） */
  selectionBarPinned?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-status-filter", status: QueueFilterStatus): void;
  (e: "toggle-type-filter", kind: QueueFilterKind): void;
  (e: "update:filterText", value: string): void;
  (e: "toggle-filter-regex-mode"): void;
  (e: "reset-queue-filters"): void;
  (e: "update:queueMode", value: QueueMode): void;
  (e: "update:sortPrimary", value: QueueSortField): void;
  (e: "update:sortPrimaryDirection", value: QueueSortDirection): void;
  (e: "update:sortSecondary", value: QueueSortField): void;
  (e: "update:sortSecondaryDirection", value: QueueSortDirection): void;
  (e: "select-all-visible-jobs"): void;
  (e: "invert-selection"): void;
  (e: "clear-selection"): void;
  (e: "bulk-cancel"): void;
  (e: "bulk-wait"): void;
  (e: "bulk-resume"): void;
  (e: "bulk-restart"): void;
  (e: "bulk-move-to-top"): void;
  (e: "bulk-move-to-bottom"): void;
  (e: "bulk-delete"): void;
  (e: "update:selectionBarPinned", value: boolean): void;
}>();

const { t } = useI18n();

// Local UI state: whether the filter panel (tags + text input) is expanded.
const filterPanelOpen = ref(false);
// Local UI state: whether the secondary sort controls are expanded.
const secondarySortExpanded = ref(false);

// 固定选择操作栏的状态（从 prop 读取，通过 emit 更新以持久化）
const selectionBarPinned = computed(() => props.selectionBarPinned ?? false);
const toggleSelectionBarPinned = () => {
  emit("update:selectionBarPinned", !selectionBarPinned.value);
};

const modeHint = computed(() =>
  props.queueMode === "queue"
    ? t("queue.modes.queueHint")
    : t("queue.modes.displayHint"),
);

watch(
  () => props.hasPrimarySortTies,
  (hasTies) => {
    if (hasTies) {
      secondarySortExpanded.value = true;
    }
  },
  { immediate: true },
);

const togglePrimarySortDirection = () => {
  emit(
    "update:sortPrimaryDirection",
    props.sortPrimaryDirection === "asc" ? "desc" : "asc",
  );
};

const toggleSecondarySortDirection = () => {
  emit(
    "update:sortSecondaryDirection",
    props.sortSecondaryDirection === "asc" ? "desc" : "asc",
  );
};
</script>

<template>
  <header
    data-testid="queue-secondary-header"
    class="shrink-0 border-b border-border bg-card/60 backdrop-blur"
  >
    <!-- 主控制栏 - 单行布局 -->
    <div class="px-3 py-1.5 overflow-x-auto">
      <div class="flex items-center justify-between gap-3 min-w-max">
        <!-- 左侧：模式和排序控制 -->
        <div class="flex items-center gap-2 shrink-0">
          <!-- 队列模式 -->
          <div class="flex items-center gap-1">
            <span class="text-xs text-muted-foreground">{{ t("queue.modeLabel") }}</span>
            <Select
              :model-value="props.queueMode"
              @update:model-value="(v) => emit('update:queueMode', v as QueueMode)"
            >
              <SelectTrigger
                data-testid="queue-mode-trigger"
                class="h-6 px-2 text-xs rounded-md bg-background/50 border-border/50 hover:bg-background/80 min-w-[90px]"
                :title="String(modeHint)"
              >
                <SelectValue>{{ t(`queue.modes.${props.queueMode}`) }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="display">{{ t("queue.modes.display") }}</SelectItem>
                <SelectItem value="queue">{{ t("queue.modes.queue") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- 分隔线 -->
          <div class="h-4 w-px bg-border/40" />

          <!-- 主排序 -->
          <div class="flex items-center gap-1">
            <span
              class="text-xs text-muted-foreground whitespace-nowrap"
              data-testid="queue-sort-primary-label"
            >
              {{ t("queue.sort.label") }}
            </span>
            <Select
              :model-value="props.sortPrimary"
              @update:model-value="(v) => emit('update:sortPrimary', v as QueueSortField)"
            >
              <SelectTrigger
                data-testid="queue-sort-primary-trigger"
                class="h-6 px-2 text-xs rounded-md bg-background/50 border-border/50 hover:bg-background/80 min-w-[100px]"
              >
                <SelectValue>{{ t(`queue.sort.fields.${props.sortPrimary}`) }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addedTime">{{ t("queue.sort.fields.addedTime") }}</SelectItem>
                <SelectItem value="finishedTime">{{ t("queue.sort.fields.finishedTime") }}</SelectItem>
                <SelectItem value="filename">{{ t("queue.sort.fields.filename") }}</SelectItem>
                <SelectItem value="status">{{ t("queue.sort.fields.status") }}</SelectItem>
                <SelectItem value="duration">{{ t("queue.sort.fields.duration") }}</SelectItem>
                <SelectItem value="elapsed">{{ t("queue.sort.fields.elapsed") }}</SelectItem>
                <SelectItem value="type">{{ t("queue.sort.fields.type") }}</SelectItem>
                <SelectItem value="path">{{ t("queue.sort.fields.path") }}</SelectItem>
                <SelectItem value="inputSize">{{ t("queue.sort.fields.inputSize") }}</SelectItem>
                <SelectItem value="outputSize">{{ t("queue.sort.fields.outputSize") }}</SelectItem>
                <SelectItem value="createdTime">{{ t("queue.sort.fields.createdTime") }}</SelectItem>
                <SelectItem value="modifiedTime">{{ t("queue.sort.fields.modifiedTime") }}</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 gap-1 text-xs"
              data-testid="queue-sort-primary-direction-toggle"
              @click="togglePrimarySortDirection"
              :title="props.sortPrimaryDirection === 'asc' ? t('queue.sort.asc') : t('queue.sort.desc')"
            >
              <ArrowUpDown v-if="props.sortPrimaryDirection === 'asc'" class="h-3 w-3" />
              <ArrowDownUp v-else class="h-3 w-3" />
              <span class="hidden sm:inline">
                {{
                  props.sortPrimaryDirection === "asc"
                    ? t("queue.sort.asc")
                    : t("queue.sort.desc")
                }}
              </span>
            </Button>

            <Button
              v-if="!secondarySortExpanded"
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 gap-1 text-xs"
              data-testid="queue-secondary-sort-expand"
              @click="secondarySortExpanded = true"
            >
              <ListOrdered class="h-3 w-3" />
              <span class="hidden sm:inline">{{ t("queue.sort.secondaryLabel") }}</span>
            </Button>
          </div>

          <!-- 二级排序 (展开时) -->
          <Transition name="fade">
            <div
              v-if="secondarySortExpanded"
              class="flex items-center gap-1"
              data-testid="queue-secondary-sort-row"
            >
              <div class="h-4 w-px bg-border/40" />
              <span
                class="text-xs text-muted-foreground whitespace-nowrap"
                data-testid="queue-sort-secondary-label"
              >
                {{ t("queue.sort.secondaryLabel") }}
              </span>
              <Select
                :model-value="props.sortSecondary"
                @update:model-value="(v) => emit('update:sortSecondary', v as QueueSortField)"
              >
                <SelectTrigger
                  data-testid="queue-sort-secondary-trigger"
                  class="h-6 px-2 text-xs rounded-md bg-background/50 border-border/50 hover:bg-background/80 min-w-[100px]"
                >
                  <SelectValue>{{ t(`queue.sort.fields.${props.sortSecondary}`) }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filename">{{ t("queue.sort.fields.filename") }}</SelectItem>
                  <SelectItem value="status">{{ t("queue.sort.fields.status") }}</SelectItem>
                  <SelectItem value="addedTime">{{ t("queue.sort.fields.addedTime") }}</SelectItem>
                  <SelectItem value="finishedTime">{{ t("queue.sort.fields.finishedTime") }}</SelectItem>
                  <SelectItem value="duration">{{ t("queue.sort.fields.duration") }}</SelectItem>
                  <SelectItem value="elapsed">{{ t("queue.sort.fields.elapsed") }}</SelectItem>
                  <SelectItem value="type">{{ t("queue.sort.fields.type") }}</SelectItem>
                  <SelectItem value="path">{{ t("queue.sort.fields.path") }}</SelectItem>
                  <SelectItem value="inputSize">{{ t("queue.sort.fields.inputSize") }}</SelectItem>
                  <SelectItem value="outputSize">{{ t("queue.sort.fields.outputSize") }}</SelectItem>
                  <SelectItem value="createdTime">{{ t("queue.sort.fields.createdTime") }}</SelectItem>
                  <SelectItem value="modifiedTime">{{ t("queue.sort.fields.modifiedTime") }}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 px-2 gap-1 text-xs"
                data-testid="queue-sort-secondary-direction-toggle"
                @click="toggleSecondarySortDirection"
                :title="props.sortSecondaryDirection === 'asc' ? t('queue.sort.asc') : t('queue.sort.desc')"
              >
                <ArrowUpDown v-if="props.sortSecondaryDirection === 'asc'" class="h-3 w-3" />
                <ArrowDownUp v-else class="h-3 w-3" />
                <span class="hidden sm:inline">
                  {{
                    props.sortSecondaryDirection === "asc"
                      ? t("queue.sort.asc")
                      : t("queue.sort.desc")
                  }}
                </span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0"
                @click="secondarySortExpanded = false"
                :title="t('queue.sort.collapse')"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
          </Transition>
        </div>

        <!-- 右侧：统计和筛选 -->
        <div class="flex items-center gap-2">
          <!-- 统计信息 -->
          <span class="text-xs text-muted-foreground">
            {{ t("queue.filters.summary", { visible: props.visibleCount, total: props.totalCount }) }}
          </span>

          <!-- 活跃筛选标记 -->
          <span
            v-if="props.hasActiveFilters"
            class="inline-flex items-center h-5 rounded-full bg-primary/10 px-2 text-[10px] font-medium text-primary"
          >
            {{ t("queue.filters.activeBadge") }}
          </span>

          <!-- 筛选按钮 -->
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs"
            @click="filterPanelOpen = !filterPanelOpen"
          >
            <Filter class="h-3 w-3" />
            <span class="hidden sm:inline">
              {{ filterPanelOpen ? t("queue.filters.collapse") : t("queue.filters.expand") }}
            </span>
            <ChevronUp class="h-3 w-3 transition-transform" :class="{ 'rotate-180': !filterPanelOpen }" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 选择操作栏 (有选中项或固定时显示) -->
    <Transition name="slide">
      <QueueSelectionBar
        v-if="props.hasSelection || selectionBarPinned"
        :selection-bar-pinned="selectionBarPinned"
        :selected-count="props.selectedCount"
        :queue-mode="props.queueMode"
        @select-all-visible-jobs="emit('select-all-visible-jobs')"
        @invert-selection="emit('invert-selection')"
        @clear-selection="emit('clear-selection')"
        @bulk-wait="emit('bulk-wait')"
        @bulk-resume="emit('bulk-resume')"
        @bulk-cancel="emit('bulk-cancel')"
        @bulk-restart="emit('bulk-restart')"
        @bulk-move-to-top="emit('bulk-move-to-top')"
        @bulk-move-to-bottom="emit('bulk-move-to-bottom')"
        @bulk-delete="emit('bulk-delete')"
        @toggle-selection-bar-pinned="toggleSelectionBarPinned"
      />
    </Transition>

    <!-- 筛选面板 -->
    <Transition name="slide">
      <QueueFiltersPanel
        v-if="filterPanelOpen"
        class="border-t border-border/60"
        :active-status-filters="props.activeStatusFilters"
        :active-type-filters="props.activeTypeFilters"
        :filter-text="props.filterText"
        :filter-use-regex="props.filterUseRegex"
        :filter-regex-error="props.filterRegexError"
        @toggle-type-filter="(kind) => emit('toggle-type-filter', kind)"
        @toggle-status-filter="(status) => emit('toggle-status-filter', status)"
        @update:filter-text="(value) => emit('update:filterText', value)"
        @toggle-filter-regex-mode="emit('toggle-filter-regex-mode')"
        @reset-queue-filters="emit('reset-queue-filters')"
      />
    </Transition>
  </header>
</template>
<style scoped src="./QueueFiltersBar.css"></style>
