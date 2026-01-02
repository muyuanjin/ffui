<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { computed } from "vue";
import { highlightFfmpegCommandTokens, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { getPresetAvgRatio } from "@/lib/presetSorter";
import { toFixedDisplay } from "@/lib/numberDisplay";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import { GripVertical, Edit, Trash2, Copy, CopyPlus, Download } from "lucide-vue-next";
import {
  getPresetDescription,
  getPresetRiskBadge,
  getPresetScenarioLabel,
  getRatioColorClass,
  isCustomCommandPreset,
  isSmartPreset,
} from "../presetHelpers";

const props = defineProps<{
  preset: FFmpegPreset;
  selected: boolean;
  predictedVmaf?: number | null;
}>();

const emit = defineEmits<{
  (e: "toggle-select", presetId: string): void;
  (e: "duplicate", preset: FFmpegPreset): void;
  (e: "exportPresetToFile", preset: FFmpegPreset): void;
  (e: "edit", preset: FFmpegPreset): void;
  (e: "delete", preset: FFmpegPreset): void;
}>();

const { t, locale } = useI18n();

const commandPreview = computed(() => getPresetCommandPreview(props.preset));
const commandTokens = computed(() => highlightFfmpegCommandTokens(commandPreview.value));

const avgRatioValue = computed(() => getPresetAvgRatio(props.preset));
const avgRatioDisplayValue = computed<number | null>(() => {
  const v = avgRatioValue.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return toFixedDisplay(v, 0)?.value ?? null;
});
const avgRatioText = computed(() => (avgRatioDisplayValue.value == null ? null : `${avgRatioDisplayValue.value}%`));
const avgRatioColorClass = computed(() => getRatioColorClass(avgRatioDisplayValue.value));

const predictedVmafText = computed(() => {
  const v = props.predictedVmaf;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return toFixedDisplay(v, 2)?.text ?? "—";
});

const measuredVmafText = computed(() => {
  const c = Number(props.preset.stats.vmafCount ?? 0);
  const sum = Number(props.preset.stats.vmafSum ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(sum)) return null;
  return toFixedDisplay(sum / c, 2)?.text ?? null;
});

const measuredVmafCount = computed(() => {
  const c = Number(props.preset.stats.vmafCount ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  return Math.floor(c);
});

const _vmafTitle = computed(() => {
  const parts: string[] = [];
  const mean = measuredVmafText.value;
  if (mean) {
    const c = measuredVmafCount.value;
    parts.push(
      c
        ? (t("presets.vmafTooltipMeasuredWithCount", { value: mean, count: c }) as string)
        : (t("presets.vmafTooltipMeasured", { value: mean }) as string),
    );
  } else if (predictedVmafText.value !== "—") {
    parts.push(t("presets.vmafTooltipPredicted", { value: predictedVmafText.value }) as string);
  }
  return parts.join(" · ") || "VMAF";
});

const handleRowClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const shouldIgnore = !!target.closest(
    "button, a, input, textarea, select, [role='button'], .drag-handle, pre, code, [data-no-select-toggle]",
  );
  if (shouldIgnore) return;

  emit("toggle-select", props.preset.id);
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
          <span
            v-if="isCustomCommandPreset(preset)"
            class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-500 px-1.5 py-0.5 text-[8px] font-medium border border-amber-500/40 flex-shrink-0"
            :title="t('presets.inferredNonAuthoritative')"
          >
            {{ t("presets.customCommandBadge") }}
          </span>
        </div>
        <p class="text-[10px] text-muted-foreground truncate">{{ getPresetDescription(preset, locale) }}</p>
        <p v-if="isCustomCommandPreset(preset)" class="text-[9px] text-amber-400 truncate">
          {{ t("presets.inferredNonAuthoritative") }}
        </p>
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
          <pre class="text-[9px] font-mono text-muted-foreground whitespace-nowrap select-text"><span
            v-for="(token, idx) in commandTokens"
            :key="idx"
            :class="token.className"
            :title="token.title"
            v-text="token.text"
          ></span></pre>
        </div>
      </div>

      <div class="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground flex-shrink-0 w-40">
        <div class="flex items-center justify-end gap-2">
          <span>{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</span>
          <span v-if="avgRatioText" class="font-medium" :class="avgRatioColorClass">
            {{ avgRatioText }}
          </span>
        </div>
        <div class="text-[9px] leading-none" :title="_vmafTitle" data-testid="preset-row-vmaf">
          <span class="text-muted-foreground">VMAF</span>
          <span v-if="measuredVmafText" class="tabular-nums mx-1 text-emerald-400">{{ measuredVmafText }}</span>
          <span v-else class="tabular-nums mx-1 text-sky-400">{{ predictedVmafText }}</span>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 hover:bg-primary/10 hover:text-primary"
        :title="t('presetEditor.advanced.copyButton')"
        @click="copyToClipboard(commandPreview)"
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
        data-testid="preset-card-edit"
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
