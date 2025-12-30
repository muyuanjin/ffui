<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sortPresets } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset, PresetSortMode } from "@/types";
import {
  GripVertical,
  Trash2,
  Copy,
  Download,
  Upload,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Pin,
  PinOff,
} from "lucide-vue-next";
import type { AcceptableValue } from "@/components/ui/select";
import type { SortableEvent } from "sortablejs";
import PresetRowCompact from "./presets/PresetRowCompact.vue";
import PresetCardGrid from "./presets/PresetCardGrid.vue";

// 视图模式：grid（卡片）或 compact（紧凑列表）
type ViewMode = "grid" | "compact";

const props = withDefaults(
  defineProps<{
    presets: FFmpegPreset[];
    sortMode?: PresetSortMode;
    viewMode?: ViewMode;
    /** 是否固定选择操作栏（即使没有选中项也显示） */
    selectionBarPinned?: boolean;
  }>(),
  {
    sortMode: "manual",
    viewMode: "grid",
    selectionBarPinned: false,
  },
);

const emit = defineEmits<{
  edit: [preset: FFmpegPreset];
  delete: [preset: FFmpegPreset];
  duplicate: [preset: FFmpegPreset];
  batchDelete: [presetIds: string[]];
  exportSelectedToFile: [presetIds: string[]];
  exportSelectedToClipboard: [presetIds: string[]];
  exportSelectedCommandsToClipboard: [presetIdsInDisplayOrder: string[]];
  exportPresetToFile: [preset: FFmpegPreset];
  reorder: [orderedIds: string[]];
  importSmartPack: [];
  importBundle: [];
  importBundleFromClipboard: [];
  importCommands: [];
  "update:sortMode": [mode: PresetSortMode];
  "update:viewMode": [mode: ViewMode];
  "update:selectionBarPinned": [value: boolean];
}>();

const { t, locale } = useI18n();
const containerRef = ref<HTMLElement | null>(null);
const localPresets = ref<FFmpegPreset[]>([...props.presets]);
const localViewMode = ref<ViewMode>(props.viewMode);
const selectedIds = ref<Set<string>>(new Set());
const selectedCount = computed(() => selectedIds.value.size);
const selectionBarPinned = computed(() => props.selectionBarPinned ?? false);
const toggleSelectionBarPinned = () => {
  emit("update:selectionBarPinned", !selectionBarPinned.value);
};

// 监听 viewMode prop 变化
watch(
  () => props.viewMode,
  (newMode) => {
    localViewMode.value = newMode;
  },
);

// 视图模式变化时发出事件
const handleViewModeChange = (mode: ViewMode) => {
  localViewMode.value = mode;
  emit("update:viewMode", mode);
};

// 排序模式
const localSortMode = ref<PresetSortMode>(props.sortMode);

// 监听 prop 变化
watch(
  () => props.sortMode,
  (newMode) => {
    localSortMode.value = newMode;
  },
);

// 排序模式变化时发出事件
const handleSortModeChange = (value: AcceptableValue) => {
  if (typeof value !== "string") return;
  const mode = value as PresetSortMode;
  localSortMode.value = mode;
  emit("update:sortMode", mode);
};

// 排序选项配置
const sortOptions: { value: PresetSortMode; labelKey: string }[] = [
  { value: "manual", labelKey: "presets.sortManual" },
  { value: "usage", labelKey: "presets.sortUsage" },
  { value: "inputSize", labelKey: "presets.sortInputSize" },
  { value: "ratio", labelKey: "presets.sortRatio" },
  { value: "speed", labelKey: "presets.sortSpeed" },
  { value: "name", labelKey: "presets.sortName" },
];

// 计算排序后的预设列表
const sortedPresets = computed(() => sortPresets(localPresets.value, localSortMode.value));

// 当前排序方式的本地化文案（SelectValue 将使用自定义插槽展示，避免切换语言后仍显示旧文本）
const currentSortLabel = computed(() => {
  // 读取 locale 以建立响应式依赖，切换语言后触发重算
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value;
  const option = sortOptions.find((o) => o.value === localSortMode.value);
  return option ? t(option.labelKey) : "";
});

// 当上游预设列表内容发生变化时，同步到本地副本
watch(
  () => props.presets,
  (newPresets) => {
    localPresets.value = [...newPresets];
  },
  { deep: true },
);

watch(
  () => props.presets.map((preset) => preset.id),
  (nextIds) => {
    const available = new Set(nextIds);
    const current = selectedIds.value;
    if (current.size === 0) return;
    const pruned = new Set<string>();
    for (const id of current) {
      if (available.has(id)) pruned.add(id);
    }
    if (pruned.size !== current.size) {
      selectedIds.value = pruned;
    }
  },
);

const isSelected = (id: string) => selectedIds.value.has(id);

const selectedIdsInDisplayOrder = computed(() =>
  sortedPresets.value.filter((preset) => selectedIds.value.has(preset.id)).map((preset) => preset.id),
);

const toggleSelected = (id: string) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
};

const clearSelection = () => {
  selectedIds.value = new Set();
};

const emitBatchDelete = () => {
  if (selectedIds.value.size === 0) return;
  emit("batchDelete", selectedIdsInDisplayOrder.value);
};

const emitExportSelectedToFile = () => {
  if (selectedIds.value.size === 0) return;
  emit("exportSelectedToFile", selectedIdsInDisplayOrder.value);
};

const emitExportSelectedToClipboard = () => {
  if (selectedIds.value.size === 0) return;
  emit("exportSelectedToClipboard", selectedIdsInDisplayOrder.value);
};

const emitExportSelectedCommandsToClipboard = () => {
  if (selectedIds.value.size === 0) return;
  emit("exportSelectedCommandsToClipboard", selectedIdsInDisplayOrder.value);
};

// Setup sortable - 始终启用拖拽
const sortable = useSortable(containerRef, localPresets, {
  animation: 150,
  handle: ".drag-handle",
  ghostClass: "opacity-30",
  chosenClass: "is-chosen",
  forceFallback: true,
  fallbackOnBody: true,
  fallbackClass: "drag-fallback",
  onUpdate: (evt: SortableEvent) => {
    const oldIndex = evt?.oldIndex;
    const newIndex = evt?.newIndex;
    if (typeof oldIndex !== "number" || typeof newIndex !== "number") return;
    if (oldIndex === newIndex) return;

    // 获取当前显示的排序结果（可能是按某种排序模式排序后的）
    const currentSorted = sortedPresets.value;
    if (!Array.isArray(currentSorted) || currentSorted.length === 0) return;
    if (oldIndex < 0 || oldIndex >= currentSorted.length) return;
    if (newIndex < 0 || newIndex >= currentSorted.length) return;

    // 在当前排序结果上应用拖拽操作
    const next = [...currentSorted];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);

    // 将新顺序固化为本地预设列表（这样切换到手动排序时不会突变）
    localPresets.value = next;

    // 如果不是手动排序模式，切换到手动排序
    if (localSortMode.value !== "manual") {
      localSortMode.value = "manual";
      emit("update:sortMode", "manual");
    }

    // 发出 reorder 事件，通知上游持久化新顺序
    const orderedIds = next.map((p) => p.id);
    emit("reorder", orderedIds);
  },
});

const updateSortableDisabled = () => {
  sortable.option("disabled", localSortMode.value !== "manual");
};

watch(localSortMode, () => updateSortableDisabled());

updateSortableDisabled();
</script>

<template>
  <div class="w-full overflow-x-hidden" data-testid="preset-panel">
    <header class="relative z-40 shrink-0 border-b border-border bg-card/60 backdrop-blur" data-testid="preset-toolbar">
      <div class="px-3 py-1.5 overflow-x-auto">
        <div class="flex items-center justify-between gap-3 min-w-max">
          <div class="flex items-center gap-2 min-w-0 shrink-0 text-xs text-muted-foreground">
            <GripVertical class="w-4 h-4 shrink-0" />
            <span class="truncate">
              {{ t("presets.dragToReorder") }} · {{ t("presets.presetCount", { count: presets.length }) }}
            </span>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <Select :model-value="localSortMode" @update:model-value="handleSortModeChange">
              <SelectTrigger
                class="h-6 px-2 text-xs rounded-md bg-background/50 border-border/50 hover:bg-background/80 min-w-[100px]"
              >
                <SelectValue>{{ currentSortLabel }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in sortOptions" :key="option.value" :value="option.value">
                  {{ t(option.labelKey) }}
                </SelectItem>
              </SelectContent>
            </Select>

            <div class="flex border rounded-md flex-shrink-0">
              <Button
                data-testid="preset-view-grid"
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0 rounded-r-none"
                :class="{ 'bg-accent': localViewMode === 'grid' }"
                @click="handleViewModeChange('grid')"
              >
                <LayoutGrid class="w-3.5 h-3.5" />
              </Button>
              <Button
                data-testid="preset-view-compact"
                variant="ghost"
                size="sm"
                class="h-7 w-7 p-0 rounded-l-none border-l"
                :class="{ 'bg-accent': localViewMode === 'compact' }"
                @click="handleViewModeChange('compact')"
              >
                <LayoutList class="w-3.5 h-3.5" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2 text-[11px] whitespace-nowrap"
              data-testid="preset-import-recommended-pack"
              @click="emit('importSmartPack')"
            >
              {{ t("presets.importSmartPack") }}
            </Button>
            <div class="flex border rounded-md flex-shrink-0 overflow-hidden">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-[11px] whitespace-nowrap rounded-none"
                data-testid="preset-import-bundle"
                @click="emit('importBundle')"
              >
                <Upload class="h-3 w-3 mr-1" />
                {{ t("presets.import") }}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 w-7 p-0 rounded-none border-l border-border/60"
                    data-testid="preset-import-menu"
                  >
                    <ChevronDown class="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  class="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover text-xs shadow-md py-1"
                  :side-offset="4"
                  :portal-disabled="true"
                >
                  <DropdownMenuItem
                    class="px-3 py-1.5 text-xs gap-2"
                    data-testid="preset-import-clipboard"
                    @select="emit('importBundleFromClipboard')"
                  >
                    <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
                    {{ t("presets.importFromClipboard") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="px-3 py-1.5 text-xs gap-2"
                    data-testid="preset-import-commands"
                    @select="emit('importCommands')"
                  >
                    <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
                    {{ t("presets.importCommands") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div class="flex border rounded-md flex-shrink-0 overflow-hidden">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-[11px] whitespace-nowrap rounded-none"
                data-testid="preset-export-file"
                :disabled="selectedCount === 0"
                @click="emitExportSelectedToFile"
              >
                <Download class="h-3 w-3 mr-1" />
                {{ t("presets.export") }}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 w-7 p-0 rounded-none border-l border-border/60"
                    data-testid="preset-export-menu"
                    :disabled="selectedCount === 0"
                  >
                    <ChevronDown class="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  class="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover text-xs shadow-md py-1"
                  :side-offset="4"
                  :portal-disabled="true"
                >
                  <DropdownMenuItem
                    class="px-3 py-1.5 text-xs gap-2"
                    data-testid="preset-export-clipboard"
                    @select="emitExportSelectedToClipboard"
                  >
                    <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
                    {{ t("presets.exportToClipboard") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="px-3 py-1.5 text-xs gap-2"
                    data-testid="preset-export-commands"
                    @select="emitExportSelectedCommandsToClipboard"
                  >
                    <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
                    {{ t("presets.copyTemplateCommands") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div
      v-if="selectedCount > 0 || selectionBarPinned"
      class="border-b border-border/60 px-3 py-1.5 bg-accent/5 text-xs"
      data-testid="preset-selection-actions"
    >
      <div class="flex items-center justify-between gap-2 min-w-max">
        <div class="text-muted-foreground">{{ t("presets.selectedCount", { count: selectedCount }) }}</div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-[11px]"
            data-testid="preset-batch-export"
            :disabled="selectedCount === 0"
            @click="emitExportSelectedToFile"
          >
            <Download class="h-3 w-3 mr-1" />
            {{ t("presets.export") }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="h-7 px-2 text-[11px]"
            data-testid="preset-batch-delete"
            :disabled="selectedCount === 0"
            @click="emitBatchDelete"
          >
            <Trash2 class="h-3 w-3 mr-1" />
            {{ t("presets.batchDelete") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-[11px]"
            :disabled="selectedCount === 0"
            @click="clearSelection"
          >
            {{ t("presets.clearSelection") }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="preset-selection-pin"
            :class="selectionBarPinned ? 'text-primary' : undefined"
            :title="selectionBarPinned ? t('presets.unpinSelectionBar') : t('presets.pinSelectionBar')"
            :aria-label="selectionBarPinned ? t('presets.unpinSelectionBar') : t('presets.pinSelectionBar')"
            @click="toggleSelectionBarPinned"
          >
            <PinOff v-if="selectionBarPinned" class="h-3 w-3 text-primary" />
            <Pin v-else class="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>

    <div class="p-4">
      <div v-if="localViewMode === 'compact'" ref="containerRef" class="space-y-1.5 overflow-hidden">
        <PresetRowCompact
          v-for="preset in sortedPresets"
          :key="preset.id"
          :preset="preset"
          :selected="isSelected(preset.id)"
          @toggle-select="toggleSelected"
          @duplicate="emit('duplicate', $event)"
          @exportPresetToFile="emit('exportPresetToFile', $event)"
          @edit="emit('edit', $event)"
          @delete="emit('delete', $event)"
        />
      </div>

      <div v-else ref="containerRef" class="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-4 items-stretch">
        <PresetCardGrid
          v-for="preset in sortedPresets"
          :key="preset.id"
          :preset="preset"
          :selected="isSelected(preset.id)"
          @toggle-select="toggleSelected"
          @duplicate="emit('duplicate', $event)"
          @exportPresetToFile="emit('exportPresetToFile', $event)"
          @edit="emit('edit', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped src="./PresetPanel.css"></style>
