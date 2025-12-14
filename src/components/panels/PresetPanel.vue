<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { highlightFfmpegCommand, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { sortPresets, getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { useI18n } from "vue-i18n";
import {
  getAudioSummary,
  getFiltersSummary,
  getPresetDescription,
  getPresetRiskBadge,
  getPresetScenarioLabel,
  getRatioColorClass,
  getSubtitleSummary,
  getVideoRateControlSummary,
  isSmartPreset,
} from "./presetHelpers";
import type { FFmpegPreset, PresetSortMode } from "@/types";
import { GripVertical, Edit, Trash2, Copy, LayoutGrid, LayoutList } from "lucide-vue-next";
import type { AcceptableValue } from "reka-ui";

// 视图模式：grid（卡片）或 compact（紧凑列表）
type ViewMode = "grid" | "compact";

const props = withDefaults(defineProps<{
  presets: FFmpegPreset[];
  sortMode?: PresetSortMode;
  viewMode?: ViewMode;
}>(), {
  sortMode: "manual",
  viewMode: "grid",
});

const emit = defineEmits<{
  edit: [preset: FFmpegPreset];
  delete: [preset: FFmpegPreset];
  reorder: [orderedIds: string[]];
  importSmartPack: [];
  "update:sortMode": [mode: PresetSortMode];
  "update:viewMode": [mode: ViewMode];
}>();

const { t, locale } = useI18n();
const containerRef = ref<HTMLElement | null>(null);
const localPresets = ref<FFmpegPreset[]>([...props.presets]);
const localViewMode = ref<ViewMode>(props.viewMode);

// 监听 viewMode prop 变化
watch(() => props.viewMode, (newMode) => {
  localViewMode.value = newMode;
});

// 视图模式变化时发出事件
const handleViewModeChange = (mode: ViewMode) => {
  localViewMode.value = mode;
  emit("update:viewMode", mode);
};

// 本地排序模式（与 prop 同步）
const localSortMode = ref<PresetSortMode>(props.sortMode);

// 监听 prop 变化
watch(() => props.sortMode, (newMode) => {
  localSortMode.value = newMode;
});

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
  { value: "ratio", labelKey: "presets.sortRatio" },
  { value: "speed", labelKey: "presets.sortSpeed" },
  { value: "name", labelKey: "presets.sortName" },
];

// 计算排序后的预设列表
const sortedPresets = computed(() => sortPresets(localPresets.value, localSortMode.value));

// 当前排序方式的本地化文案（SelectValue 将使用自定义插槽展示，避免切换语言后仍显示旧文本）
const currentSortLabel = computed(() => {
  // 读取 locale 以建立响应式依赖，切换语言后触发重算
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

// Setup sortable - 始终启用拖拽
useSortable(containerRef, localPresets, {
  animation: 150,
  handle: ".drag-handle",
  ghostClass: "opacity-30",
  chosenClass: "is-chosen",
  forceFallback: true,
  fallbackOnBody: true,
  fallbackClass: "drag-fallback",
  onUpdate: (evt: any) => {
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

</script>

<template>
  <div class="w-full max-w-6xl mx-auto px-4 overflow-x-hidden" data-testid="preset-panel">
    <div class="mb-4 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0 flex-shrink">
        <GripVertical class="w-4 h-4 flex-shrink-0" />
        <span class="truncate">
          {{ t("presets.dragToReorder") }} · {{ t("presets.presetCount", { count: presets.length }) }}
        </span>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <Select
          :key="locale"
          :model-value="localSortMode"
          @update:model-value="handleSortModeChange"
        >
          <SelectTrigger class="h-7 w-[100px] text-[11px]">
            <SelectValue>
              {{ currentSortLabel }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in sortOptions" :key="option.value" :value="option.value">
              {{ t(option.labelKey) }}
            </SelectItem>
          </SelectContent>
        </Select>

        <div class="flex border rounded-md flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 rounded-r-none"
            :class="{ 'bg-accent': localViewMode === 'grid' }"
            @click="handleViewModeChange('grid')"
          >
            <LayoutGrid class="w-3.5 h-3.5" />
          </Button>
          <Button
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
          @click="emit('importSmartPack')"
        >
          {{ t("presets.importSmartPack") }}
        </Button>
      </div>
    </div>

    <div v-if="localViewMode === 'compact'" ref="containerRef" class="space-y-1.5 overflow-hidden">
      <div
        v-for="preset in sortedPresets"
        :key="preset.id"
        class="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/95 hover:bg-accent/50 transition-colors"
      >
        <div
          class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
        >
          <GripVertical class="w-4 h-4" />
        </div>

        <div class="flex-1 min-w-0 flex items-center gap-3">
          <div class="min-w-0 flex-shrink-0" style="width: 160px">
            <div class="flex items-center gap-1.5">
              <span class="font-medium text-sm truncate">{{ preset.name }}</span>
              <span
                v-if="isSmartPreset(preset)"
                class="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[8px] font-medium border border-primary/40 flex-shrink-0"
              >
                {{ t("presets.recommendedSmart") }}
              </span>
            </div>
            <p class="text-[10px] text-muted-foreground truncate">{{ getPresetDescription(preset, locale) }}</p>
            <div class="mt-0.5 flex items-center flex-wrap gap-1">
              <span class="text-[9px] text-muted-foreground">
                {{ t("presetEditor.panel.scenarioLabel") }}：
                <span class="text-[9px] text-foreground">
                  {{ getPresetScenarioLabel(preset, t) }}
                </span>
              </span>
              <span
                v-if="getPresetRiskBadge(preset, t)"
                class="inline-flex items-center rounded-full border border-amber-500/50 text-amber-500 px-1.5 py-0.5 text-[9px] font-medium"
              >
                {{ getPresetRiskBadge(preset, t) }}
              </span>
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div
              class="w-full max-w-full rounded bg-background/80 border border-border/30 px-2 py-1 overflow-x-auto overflow-y-hidden scrollbar-thin"
            >
              <pre
                class="text-[9px] font-mono text-muted-foreground whitespace-nowrap select-text"
                v-html="highlightFfmpegCommand(getPresetCommandPreview(preset))"
              />
            </div>
          </div>

          <div
            class="flex items-center justify-end gap-2 text-[10px] text-muted-foreground flex-shrink-0 w-32"
          >
            <span>{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</span>
            <span
              v-if="getPresetAvgRatio(preset) !== null"
              class="font-medium"
              :class="getRatioColorClass(getPresetAvgRatio(preset))"
            >
              {{ getPresetAvgRatio(preset)?.toFixed(0) }}%
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
            @click="copyToClipboard(getPresetCommandPreview(preset))"
          >
            <Copy class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
            @click="emit('edit', preset)"
          >
            <Edit class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
            @click="emit('delete', preset)"
          >
            <Trash2 class="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>

    <div v-else ref="containerRef" class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
      <Card
        v-for="preset in sortedPresets"
        :key="preset.id"
        class="relative group overflow-hidden border border-border/50 bg-card/95 backdrop-blur hover:shadow-md transition-all duration-200 h-full flex flex-col"
      >
        <CardHeader class="pb-3 pt-3 px-4">
          <div class="flex items-start gap-2">
            <div
              class="drag-handle cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <GripVertical class="w-4 h-4" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-base leading-tight truncate">{{ preset.name }}</h3>
              <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">{{ getPresetDescription(preset, locale) }}</p>
              <div class="mt-1 flex items-center flex-wrap gap-1">
                <span class="text-[10px] text-muted-foreground">
                  {{ t("presetEditor.panel.scenarioLabel") }}：
                  <span class="text-[10px] text-foreground">
                    {{ getPresetScenarioLabel(preset, t) }}
                  </span>
                </span>
                <span
                  v-if="getPresetRiskBadge(preset, t)"
                  class="inline-flex items-center rounded-full border border-amber-500/50 text-amber-500 px-1.5 py-0.5 text-[9px] font-medium"
                >
                  {{ getPresetRiskBadge(preset, t) }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span
                v-if="isSmartPreset(preset)"
                class="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[9px] font-medium border border-primary/40"
              >
                {{ t("presets.recommendedSmart") }}
              </span>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                @click="emit('edit', preset)"
              >
                <Edit class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                @click="emit('delete', preset)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent class="px-4 pb-3 pt-0 flex-1 flex flex-col space-y-2.5">
          <div class="flex-1 flex flex-col space-y-2.5">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-muted/40 rounded px-2 py-1.5 border border-border/30">
                <div class="text-[10px] text-muted-foreground font-medium mb-0.5">{{ t("presets.videoLabel") }}</div>
                <div class="font-mono text-[11px] text-foreground leading-tight">{{ preset.video.encoder }}</div>
                <div class="font-mono text-[10px] text-primary mt-0.5">
                  {{ getVideoRateControlSummary(preset.video) }}
                  <span v-if="preset.video.pass" class="text-amber-500 ml-1">{{ t("presets.twoPass") }}</span>
                </div>
              </div>
              <div class="bg-muted/40 rounded px-2 py-1.5 border border-border/30">
                <div class="text-[10px] text-muted-foreground font-medium mb-0.5">{{ t("presets.audioLabel") }}</div>
                <div class="font-mono text-[11px] text-foreground leading-tight">{{ getAudioSummary(preset.audio, t) }}</div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
                <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.filtersLabel") }}:</span>
                <span class="text-[10px] text-foreground ml-1">{{ getFiltersSummary(preset, t) }}</span>
              </div>
              <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
                <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.subtitlesLabel") }}:</span>
                <span class="text-[10px] text-foreground ml-1">{{ getSubtitleSummary(preset, t) }}</span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
                <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.hardwareLabel") }}:</span>
                <span
                  class="text-[10px] ml-1"
                  :class="preset.hardware?.hwaccel ? 'text-amber-500 font-mono' : 'text-muted-foreground'"
                >
                  {{ preset.hardware?.hwaccel || t("presets.hardwarePlaceholder") }}
                </span>
              </div>
              <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
                <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.containerLabel") }}:</span>
                <span
                  class="text-[10px] ml-1"
                  :class="preset.container?.format || preset.container?.movflags?.length ? 'text-foreground font-mono' : 'text-muted-foreground'"
                >
                  {{
                    preset.container?.format
                      || (preset.container?.movflags?.length ? preset.container.movflags.join("+") : t("presets.containerPlaceholder"))
                  }}
                </span>
              </div>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">{{ t("presets.commandPreviewLabel") }}</span>
                <Button variant="ghost" size="sm" class="h-5 px-1.5 text-[9px] hover:bg-muted" @click="copyToClipboard(getPresetCommandPreview(preset))">
                  <Copy class="h-3 w-3 mr-1" />
                  {{ t("presetEditor.advanced.copyButton") }}
                </Button>
              </div>
              <p class="text-[9px] text-muted-foreground">
                {{ t("presets.commandPreviewHint") }}
              </p>
              <pre
                class="rounded bg-background/90 border border-border/40 px-2 py-1 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-16 overflow-y-auto select-text scrollbar-thin"
                v-html="highlightFfmpegCommand(getPresetCommandPreview(preset))"
              />
            </div>
          </div>

          <div class="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30 mt-auto">
            <div>{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</div>
            <div class="flex gap-2 items-center min-w-0 justify-end whitespace-nowrap overflow-hidden">
              <span class="truncate">
                {{ t("presets.totalIn", { gb: (preset.stats.totalInputSizeMB / 1024).toFixed(1) }) }}
              </span>
              <span
                v-if="getPresetAvgRatio(preset) !== null"
                class="font-medium truncate"
                :class="getRatioColorClass(getPresetAvgRatio(preset))"
              >
                {{ t("presets.avgRatio", { percent: getPresetAvgRatio(preset)?.toFixed(1) ?? '0.0' }) }}
              </span>
              <span v-if="getPresetAvgSpeed(preset) !== null" class="truncate">
                {{ t("presets.avgSpeed", { mbps: getPresetAvgSpeed(preset)?.toFixed(1) ?? '0.0' }) }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped src="./PresetPanel.css"></style>
