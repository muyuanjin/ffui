<script setup lang="ts">
import { ref, watch } from "vue";
import { useSortable } from "@vueuse/integrations/useSortable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { highlightFfmpegCommand, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import { GripVertical, Edit, Trash2, Copy } from "lucide-vue-next";

const props = defineProps<{
  /** List of presets */
  presets: FFmpegPreset[];
}>();

const emit = defineEmits<{
  edit: [preset: FFmpegPreset];
  delete: [preset: FFmpegPreset];
  reorder: [orderedIds: string[]];
  importSmartPack: [];
}>();

const { t } = useI18n();
const containerRef = ref<HTMLElement | null>(null);
const localPresets = ref<FFmpegPreset[]>([...props.presets]);

// 当上游预设列表内容发生变化（例如在参数面板中保存后）时，同步到本地副本，
// 确保卡片上的参数展示与详情面板保持一致。
watch(
  () => props.presets,
  (newPresets) => {
    localPresets.value = [...newPresets];
  },
  { deep: true },
);

// Setup sortable
useSortable(containerRef, localPresets, {
  animation: 150,
  // 只允许通过拖动把手来拖拽卡片，避免误触
  handle: ".drag-handle",
  ghostClass: "opacity-30",
  // SortableJS 的 chosenClass 仅支持单个类名；
  // 这里使用自定义类并在样式中通过 Tailwind @apply 组合出需要的视觉效果。
  chosenClass: "is-chosen",
  // 在 Tauri/WebView 等环境下强制使用 fallback 提升兼容性
  forceFallback: true,
  fallbackOnBody: true,
  fallbackClass: "drag-fallback",
  // 注意：SortableJS 的事件顺序为 update → sort → end。
  // useSortable 内部默认在 onUpdate 中用 nextTick 异步更新 list，
  // 如果我们在 onEnd 中读取 list，很容易拿到的是“旧顺序”，看起来像“松手后弹回原位”。
  //
  // 因此这里覆写 onUpdate：根据 oldIndex/newIndex 同步调整本地数组，
  // 然后立刻按最新顺序发出 reorder 事件，由上游负责持久化到后端。
  onUpdate: (evt: any) => {
    const oldIndex = evt?.oldIndex;
    const newIndex = evt?.newIndex;
    if (typeof oldIndex !== "number" || typeof newIndex !== "number") return;

    const current = localPresets.value;
    if (!Array.isArray(current) || oldIndex === newIndex) return;
    if (oldIndex < 0 || oldIndex >= current.length) return;
    if (newIndex < 0 || newIndex >= current.length) return;

    const next = [...current];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    localPresets.value = next;

    const orderedIds = next.map((p) => p.id);
    emit("reorder", orderedIds);
  },
});

const getPresetAvgRatio = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const output = preset.stats.totalOutputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) return null;
  const ratio = (1 - output / input) * 100;
  return Math.max(Math.min(ratio, 100), -100);
};

const getPresetAvgSpeed = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const time = preset.stats.totalTimeSeconds;
  if (!input || !time || time <= 0) return null;
  return input / time;
};

const getVideoRateControlSummary = (video: FFmpegPreset["video"]): string => {
  const mode = video.rateControl;

  if (mode === "crf") {
    return `CRF ${video.qualityValue}`;
  }
  if (mode === "cq") {
    return `CQ ${video.qualityValue}`;
  }

  if (mode === "cbr") {
    if (typeof video.bitrateKbps === "number" && video.bitrateKbps > 0) {
      return `CBR ${video.bitrateKbps}k`;
    }
    return "CBR";
  }

  if (mode === "vbr") {
    if (typeof video.bitrateKbps === "number" && video.bitrateKbps > 0) {
      return `VBR ${video.bitrateKbps}k`;
    }
    return "VBR";
  }

  // 兜底：理论上已覆盖所有 rateControl 枚举值；
  // 但为兼容未来新增值，使用 String() 转为字符串避免 TS 将其收窄为 never。
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
  if (!preset.subtitles || preset.subtitles.strategy === "keep") {
    return t("presets.subtitleKeep");
  }
  if (preset.subtitles.strategy === "drop") {
    return t("presets.subtitleDrop");
  }
  return t("presets.subtitleBurnIn");
};

// 音频摘要：避免出现 “AAC 0k” 这类看起来像假数据的展示。
// - copy: 显示“复制”
// - 其他：如果有有效 bitrate 显示 “CODEC 192k”，否则仅显示 “CODEC”
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
  return typeof preset.id === "string" && preset.id.startsWith("smart-");
};
</script>

<template>
  <div class="w-full max-w-6xl mx-auto px-4">
    <!-- Header with hint and actions -->
    <div class="mb-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <GripVertical class="w-4 h-4" />
        <span>
          {{ t("presets.dragToReorder") }} ·
          {{ t("presets.presetCount", { count: presets.length }) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          @click="emit('importSmartPack')"
        >
          {{ t("presets.importSmartPack") }}
        </Button>
      </div>
    </div>

    <!-- Presets Grid -->
    <div ref="containerRef" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card
        v-for="preset in localPresets"
        :key="preset.id"
        class="relative group overflow-hidden border border-border/50 bg-card/95 backdrop-blur hover:shadow-md transition-all duration-200"
      >
        <CardHeader class="pb-3 pt-3 px-4">
          <!-- Title Row with Drag Handle -->
          <div class="flex items-start gap-2">
            <div
              class="drag-handle cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Drag to reorder"
            >
              <GripVertical class="w-4 h-4" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-base leading-tight truncate">
                {{ preset.name }}
              </h3>
              <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {{ preset.description }}
              </p>
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
                data-prevent-drag
                @click="emit('edit', preset)"
              >
                <Edit class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                data-prevent-drag
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
            <!-- Video -->
            <div class="bg-muted/40 rounded px-2 py-1.5 border border-border/30">
              <div class="text-[10px] text-muted-foreground font-medium mb-0.5">
                {{ t("presets.videoLabel") }}
              </div>
              <div class="font-mono text-[11px] text-foreground leading-tight">
                {{ preset.video.encoder }}
              </div>
              <div class="font-mono text-[10px] text-primary mt-0.5">
                {{ getVideoRateControlSummary(preset.video) }}
                <span v-if="preset.video.pass" class="text-amber-500 ml-1">{{ t("presets.twoPass") }}</span>
              </div>
            </div>

            <!-- Audio -->
            <div class="bg-muted/40 rounded px-2 py-1.5 border border-border/30">
              <div class="text-[10px] text-muted-foreground font-medium mb-0.5">
                {{ t("presets.audioLabel") }}
              </div>
              <div class="font-mono text-[11px] text-foreground leading-tight">
                <span>
                  {{ getAudioSummary(preset.audio) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Secondary Parameters Grid -->
          <div class="grid grid-cols-2 gap-2 text-xs">
            <!-- Filters -->
            <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.filtersLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1">{{ getFiltersSummary(preset) }}</span>
            </div>

            <!-- Subtitles -->
            <div class="bg-background/50 rounded px-2 py-1 border border-border/20">
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.subtitlesLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1">{{ getSubtitleSummary(preset) }}</span>
            </div>

            <!-- Hardware (if enabled) -->
            <div
              v-if="preset.hardware?.hwaccel"
              class="bg-background/50 rounded px-2 py-1 border border-border/20"
            >
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.hardwareLabel") }}:</span>
              <span class="text-[10px] text-amber-500 ml-1 font-mono">{{ preset.hardware.hwaccel }}</span>
            </div>

            <!-- Container (if customized) -->
            <div
              v-if="preset.container?.format || preset.container?.movflags?.length"
              class="bg-background/50 rounded px-2 py-1 border border-border/20"
            >
              <span class="text-[10px] text-muted-foreground font-medium">{{ t("presets.containerLabel") }}:</span>
              <span class="text-[10px] text-foreground ml-1 font-mono">
                {{ preset.container.format || preset.container.movflags?.join("+") }}
              </span>
            </div>
          </div>

          <!-- Command Preview -->
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">
                {{ t("presets.commandPreviewLabel") }}
              </span>
              <Button
                variant="ghost"
                size="sm"
                class="h-5 px-1.5 text-[9px] hover:bg-muted"
                @click="copyToClipboard(getPresetCommandPreview(preset))"
              >
                <Copy class="h-3 w-3 mr-1" />
                {{ t("presetEditor.advanced.copyButton") }}
              </Button>
            </div>
            <pre
              class="rounded bg-background/90 border border-border/40 px-2 py-1 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-16 overflow-y-auto select-text scrollbar-thin"
              v-html="highlightFfmpegCommand(getPresetCommandPreview(preset))"
            />
          </div>

          <!-- Stats Row -->
          <div class="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            <div>
              {{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}
            </div>
            <div class="flex gap-2 items-center">
              <span>
                {{ t("presets.totalIn", { gb: (preset.stats.totalInputSizeMB / 1024).toFixed(1) }) }}
              </span>
              <span v-if="getPresetAvgRatio(preset) !== null" class="text-primary font-medium">
                {{ t("presets.avgRatio", { percent: getPresetAvgRatio(preset)?.toFixed(1) ?? "0.0" }) }}
              </span>
              <span v-if="getPresetAvgSpeed(preset) !== null">
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

/* 拖拽选中态：避免在 @apply 中使用自定义颜色类导致构建期报错。
   使用纯 CSS 模拟 Tailwind 的 ring 效果，颜色取主题主色变量。 */
.is-chosen {
  box-shadow: 0 0 0 2px hsl(var(--primary));
}
</style>
