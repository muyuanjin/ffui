<script setup lang="ts">
import { toRefs } from "vue";
import { Button } from "@/components/ui/button";
import { highlightFfmpegCommand, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { getPresetAvgRatio } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import { GripVertical, Edit, Trash2, Copy, CopyPlus, Download } from "lucide-vue-next";
import {
  getPresetDescription,
  getPresetRiskBadge,
  getPresetScenarioLabel,
  getRatioColorClass,
  isSmartPreset,
} from "../presetHelpers";

const props = defineProps<{
  preset: FFmpegPreset;
  selected: boolean;
}>();

const { preset, selected } = toRefs(props);

const emit = defineEmits<{
  (e: "toggle-select", presetId: string): void;
  (e: "duplicate", preset: FFmpegPreset): void;
  (e: "exportPresetToFile", preset: FFmpegPreset): void;
  (e: "edit", preset: FFmpegPreset): void;
  (e: "delete", preset: FFmpegPreset): void;
}>();

const { t, locale } = useI18n();

const handleRowClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const shouldIgnore = !!target.closest(
    "button, a, input, textarea, select, [role='button'], .drag-handle, pre, code, [data-no-select-toggle]",
  );
  if (shouldIgnore) return;

  emit("toggle-select", preset.value.id);
};
</script>

<template>
  <div
    class="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/95 hover:bg-accent/50 transition-colors"
    data-testid="preset-card-root"
    :data-preset-id="preset.id"
    @click="handleRowClick"
  >
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      class="w-1 h-10 p-0 rounded-full transition-all flex-shrink-0"
      :class="selected ? 'bg-amber-500' : 'bg-muted-foreground/30'"
      data-testid="preset-select-toggle"
      :title="t('presets.toggleSelect')"
      @click.stop="emit('toggle-select', preset.id)"
    />
    <div
      class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
      @click.stop
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

      <div class="flex items-center justify-end gap-2 text-[10px] text-muted-foreground flex-shrink-0 w-32">
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
        :title="t('presetEditor.advanced.copyButton')"
        @click="copyToClipboard(getPresetCommandPreview(preset))"
      >
        <Copy class="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
        data-testid="preset-card-duplicate"
        :title="t('presets.duplicatePreset')"
        @click="emit('duplicate', preset)"
      >
        <CopyPlus class="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
        data-testid="preset-card-export"
        :title="t('presets.exportPresetToFile')"
        @click="emit('exportPresetToFile', preset)"
      >
        <Download class="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
        :title="t('presetEditor.actions.edit')"
        @click="emit('edit', preset)"
      >
        <Edit class="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
        :title="t('app.actions.deletePreset')"
        @click="emit('delete', preset)"
      >
        <Trash2 class="h-3 w-3" />
      </Button>
    </div>
  </div>
</template>
