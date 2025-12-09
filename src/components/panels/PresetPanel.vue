<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { highlightFfmpegCommand, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { resolvePresetDescription } from "@/lib/presetLocalization";
import { sortPresets, getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
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

const getVideoRateControlSummary = (video: FFmpegPreset["video"]): string => {
  const mode = video.rateControl;
  if (mode === "crf") return `CRF ${video.qualityValue}`;
  if (mode === "cq") return `CQ ${video.qualityValue}`;
  if (mode === "cbr") {
    return typeof video.bitrateKbps === "number" && video.bitrateKbps > 0
      ? `CBR ${video.bitrateKbps}k` : "CBR";
  }
  if (mode === "vbr") {
    return typeof video.bitrateKbps === "number" && video.bitrateKbps > 0
      ? `VBR ${video.bitrateKbps}k` : "VBR";
  }
  return String(mode).toUpperCase();
};

const getFiltersSummary = (preset: FFmpegPreset): string => {
  const parts: string[] = [];
  if (preset.filters.scale) parts.push(`${t("presets.scale")}: ${preset.filters.scale}`);
  if (preset.filters.crop) parts.push(`${t("presets.crop")}: ${preset.filters.crop}`);
  if (preset.filters.fps) parts.push(`${t("presets.fps")}: ${preset.filters.fps}`);
  return parts.length > 0 ? parts.join(", ") : t("presets.noFilters");
};

const getSubtitleSummary = (preset: FFmpegPreset): string => {
  if (!preset.subtitles || preset.subtitles.strategy === "keep") return t("presets.subtitleKeep");
  if (preset.subtitles.strategy === "drop") return t("presets.subtitleDrop");
  return t("presets.subtitleBurnIn");
};

const getAudioSummary = (audio: FFmpegPreset["audio"]) => {
  if (audio.codec === "copy") return t("presets.audioCopy");
  const name = String(audio.codec).toUpperCase();
  const br = typeof audio.bitrate === "number" && audio.bitrate > 0 ? `${audio.bitrate}k` : "";
  return br ? `${name} ${br}` : name;
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  try {
    if ("clipboard" in navigator && (navigator as any).clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch (error) {
    console.error("navigator.clipboard.writeText failed", error);
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (error) {
    console.error("Fallback copy to clipboard failed", error);
  }
};

const isSmartPreset = (preset: FFmpegPreset): boolean => {
  // 优先使用显式的 isSmartPreset 字段，兼容旧数据使用 ID 前缀判断
  if (typeof preset.isSmartPreset === "boolean") {
    return preset.isSmartPreset;
  }
  return typeof preset.id === "string" && preset.id.startsWith("smart-");
};

const getPresetDescription = (preset: FFmpegPreset): string =>
  resolvePresetDescription(preset, locale.value);
</script>

<template>
  <div class="w-full max-w-6xl mx-auto px-4 overflow-x-hidden">
    <!-- Header with hint and actions -->
    <div class="mb-4 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0 flex-shrink">
        <GripVertical class="w-4 h-4 flex-shrink-0" />
        <span class="truncate">
          {{ t("presets.dragToReorder") }} · {{ t("presets.presetCount", { count: presets.length }) }}
        </span>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- 排序下拉选择 -->
        <Select :model-value="localSortMode" @update:model-value="handleSortModeChange">
          <SelectTrigger class="h-7 w-[100px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in sortOptions" :key="option.value" :value="option.value">
              {{ t(option.labelKey) }}
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- 视图切换按钮 -->
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

    <!-- 紧凑视图 -->
    <div v-if="localViewMode === 'compact'" ref="containerRef" class="space-y-1.5 overflow-hidden">
      <div
        v-for="preset in sortedPresets"
        :key="preset.id"
        class="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/95 hover:bg-accent/50 transition-colors"
      >
        <!-- 拖拽把手 -->
        <div
          class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
        >
          <GripVertical class="w-4 h-4" />
        </div>

        <!-- 名称和描述 -->
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
            <p class="text-[10px] text-muted-foreground truncate">{{ getPresetDescription(preset) }}</p>
          </div>

          <!-- 命令预览（紧凑视图：限制宽度，超长命令在内部横向滚动，避免撑开整行） -->
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

          <!-- 统计信息（固定宽度，保证命令预览区域在各行之间宽度一致） -->
          <div
            class="flex items-center justify-end gap-2 text-[10px] text-muted-foreground flex-shrink-0 w-32"
          >
            <span>{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</span>
            <span v-if="getPresetAvgRatio(preset) !== null" class="text-primary font-medium">
              {{ getPresetAvgRatio(preset)?.toFixed(0) }}%
            </span>
          </div>
        </div>

        <!-- 操作按钮 -->
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

    <!-- 卡片视图 -->
    <div v-else ref="containerRef" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card
        v-for="preset in sortedPresets"
        :key="preset.id"
        class="relative group overflow-hidden border border-border/50 bg-card/95 backdrop-blur hover:shadow-md transition-all duration-200"
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
              <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">{{ getPresetDescription(preset) }}</p>
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

        <CardContent class="px-4 pb-3 pt-0 space-y-2.5">
          <!-- Primary Parameters Grid -->
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
              <div class="font-mono text-[11px] text-foreground leading-tight">{{ getAudioSummary(preset.audio) }}</div>
            </div>
          </div>

          <!-- Secondary Parameters Grid -->
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.filtersLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1">{{ getFiltersSummary(preset) }}</span>
            </div>
            <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.subtitlesLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1">{{ getSubtitleSummary(preset) }}</span>
            </div>
            <div v-if="preset.hardware?.hwaccel" class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.hardwareLabel") }}:</span>
              <span class="text-[10px] text-amber-500 ml-1 font-mono">{{ preset.hardware.hwaccel }}</span>
            </div>
            <div v-if="preset.container?.format || preset.container?.movflags?.length" class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.containerLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1 font-mono">{{ preset.container.format || preset.container.movflags?.join("+") }}</span>
            </div>
          </div>

          <!-- Command Preview -->
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">{{ t("presets.commandPreviewLabel") }}</span>
              <Button variant="ghost" size="sm" class="h-5 px-1.5 text-[9px] hover:bg-muted" @click="copyToClipboard(getPresetCommandPreview(preset))">
                <Copy class="h-3 w-3 mr-1" />
                {{ t("presetEditor.advanced.copyButton") }}
              </Button>
            </div>
            <pre
              class="rounded bg-background/90 border border-border/40 px-2 py-1 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-16 overflow-y-auto select-text scrollbar-thin"
              v-html="highlightFfmpegCommand(getPresetCommandPreview(preset))"
            />
          </div>

          <!-- Stats Row：强制单行显示，防止部分卡片因长统计文本换行导致高度不一致 -->
          <div class="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            <div>{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</div>
            <div class="flex gap-2 items-center min-w-0 justify-end whitespace-nowrap overflow-hidden">
              <span class="truncate">
                {{ t("presets.totalIn", { gb: (preset.stats.totalInputSizeMB / 1024).toFixed(1) }) }}
              </span>
              <span
                v-if="getPresetAvgRatio(preset) !== null"
                class="text-primary font-medium truncate"
              >
                {{ t("presets.avgRatio", { percent: getPresetAvgRatio(preset)?.toFixed(1) ?? "0.0" }) }}
              </span>
              <span v-if="getPresetAvgSpeed(preset) !== null" class="truncate">
                {{ t("presets.avgSpeed", { mbps: getPresetAvgSpeed(preset)?.toFixed(1) ?? "0.0" }) }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 2px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}

.is-chosen {
  box-shadow: 0 0 0 2px hsl(var(--primary));
}
</style>
