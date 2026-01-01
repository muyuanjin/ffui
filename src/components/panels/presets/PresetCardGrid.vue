<script setup lang="ts">
import { computed, toRefs } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { highlightFfmpegCommandTokens, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { getPresetAvgFps, getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import { GripVertical, Edit, Trash2, Copy, CopyPlus, Download, CircleHelp } from "lucide-vue-next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getAudioSummary,
  getFiltersSummary,
  getPresetDescription,
  getPresetRiskBadge,
  getPresetScenarioLabel,
  getRatioColorClass,
  getSubtitleSummary,
  getVideoRateControlSummary,
  isCustomCommandPreset,
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

const commandPreview = computed(() => getPresetCommandPreview(preset.value));
const commandTokens = computed(() => highlightFfmpegCommandTokens(commandPreview.value));
const inputGbText = computed(() => (preset.value.stats.totalInputSizeMB / 1024).toFixed(1));
const avgRatioValue = computed(() => getPresetAvgRatio(preset.value));
const avgRatioText = computed(() => avgRatioValue.value?.toFixed(0) ?? "—");
const avgSpeedText = computed(() => getPresetAvgSpeed(preset.value)?.toFixed(1) ?? "—");
const avgFpsText = computed(() => getPresetAvgFps(preset.value)?.toFixed(0) ?? "—");

const handleCardClick = (event: MouseEvent) => {
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
  <Card
    class="relative group overflow-hidden border border-border/50 bg-card/95 backdrop-blur hover:shadow-md transition-all duration-200 h-full flex flex-col"
    data-testid="preset-card-root"
    :data-preset-id="preset.id"
    @click="handleCardClick"
  >
    <CardHeader class="pb-3 pt-3 px-4">
      <div class="flex items-start gap-2">
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
          class="drag-handle cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          @click.stop
        >
          <GripVertical class="w-4 h-4" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold text-base leading-tight truncate">{{ preset.name }}</h3>
          <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {{ getPresetDescription(preset, locale) }}
          </p>
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
        <div class="flex items-start gap-1.5 flex-shrink-0">
          <span
            v-if="isSmartPreset(preset)"
            class="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[9px] font-medium border border-primary/40"
          >
            {{ t("presets.recommendedSmart") }}
          </span>
          <span
            v-if="isCustomCommandPreset(preset)"
            class="inline-flex items-center rounded-full bg-amber-500/10 text-amber-500 px-2 py-0.5 text-[9px] font-medium border border-amber-500/40"
            :title="t('presets.inferredNonAuthoritative')"
          >
            {{ t("presets.customCommandBadge") }}
          </span>
          <div class="grid grid-cols-2 gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 hover:bg-primary/10 hover:text-primary"
              data-testid="preset-card-duplicate"
              :title="t('presets.duplicatePreset')"
              @click="emit('duplicate', preset)"
            >
              <CopyPlus class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 hover:bg-primary/10 hover:text-primary"
              data-testid="preset-card-export"
              :title="t('presets.exportPresetToFile')"
              @click="emit('exportPresetToFile', preset)"
            >
              <Download class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 hover:bg-primary/10 hover:text-primary"
              :title="t('presetEditor.actions.edit')"
              @click="emit('edit', preset)"
            >
              <Edit class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :title="t('app.actions.deletePreset')"
              @click="emit('delete', preset)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </CardHeader>

    <CardContent class="px-4 pb-3 pt-0 flex-1 flex flex-col space-y-2.5">
      <div v-if="isCustomCommandPreset(preset)" class="text-[10px] text-amber-400">
        {{ t("presets.inferredNonAuthoritative") }}
      </div>
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
            <div class="font-mono text-[11px] text-foreground leading-tight">
              {{ getAudioSummary(preset.audio, t) }}
            </div>
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
              :class="
                preset.container?.format || preset.container?.movflags?.length
                  ? 'text-foreground font-mono'
                  : 'text-muted-foreground'
              "
            >
              {{
                preset.container?.format ||
                (preset.container?.movflags?.length
                  ? preset.container.movflags.join("+")
                  : t("presets.containerPlaceholder"))
              }}
            </span>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1">
              <span class="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">{{
                t("presets.commandPreviewLabel")
              }}</span>
              <TooltipProvider :delay-duration="120">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="h-4 w-4 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      :title="t('presets.commandPreviewHint')"
                      :aria-label="t('presets.commandPreviewHint')"
                      data-no-select-toggle
                      @click.stop
                      @mousedown.stop
                    >
                      <CircleHelp class="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" :side-offset="6" class="max-w-[320px] text-[10px] leading-snug">
                    {{ t("presets.commandPreviewHint") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="h-5 px-1.5 text-[9px] hover:bg-muted"
              :title="t('presetEditor.advanced.copyButton')"
              @click="copyToClipboard(commandPreview)"
            >
              <Copy class="h-3 w-3 mr-1" />
              {{ t("presetEditor.advanced.copyButton") }}
            </Button>
          </div>
          <pre
            class="rounded bg-background/90 border border-border/40 px-2 py-1 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-16 overflow-y-auto select-text scrollbar-thin"
          ><span
            v-for="(token, idx) in commandTokens"
            :key="idx"
            :class="token.className"
            :title="token.title"
            v-text="token.text"
          ></span></pre>
        </div>
      </div>

      <div class="text-[10px] text-muted-foreground pt-1 border-t border-border/30 mt-auto">
        <div
          class="grid grid-cols-5 items-center whitespace-nowrap text-[9px] leading-none tracking-tight divide-x divide-border/25"
        >
          <div class="text-center px-1">
            <i18n-t keypath="presets.cardStats.used" scope="global" :count="preset.stats.usageCount" tag="span">
              <template #count>
                <span class="text-foreground tabular-nums mx-1">{{ preset.stats.usageCount }}</span>
              </template>
            </i18n-t>
          </div>
          <div class="text-center px-1">
            <i18n-t keypath="presets.cardStats.input" scope="global" :gb="inputGbText" tag="span">
              <template #gb>
                <span class="text-foreground tabular-nums mx-1">{{ inputGbText }}</span>
              </template>
            </i18n-t>
          </div>
          <div class="text-center px-1">
            <i18n-t keypath="presets.cardStats.size" scope="global" :percent="avgRatioText" tag="span">
              <template #percent>
                <span class="tabular-nums mx-1" :class="getRatioColorClass(avgRatioValue)">
                  {{ avgRatioText }}
                </span>
              </template>
            </i18n-t>
          </div>
          <div class="text-center px-1">
            <i18n-t keypath="presets.cardStats.throughput" scope="global" :mbps="avgSpeedText" tag="span">
              <template #mbps>
                <span class="text-foreground tabular-nums mx-1">{{ avgSpeedText }}</span>
              </template>
            </i18n-t>
          </div>
          <div class="text-center px-1">
            <i18n-t keypath="presets.cardStats.fps" scope="global" :fps="avgFpsText" tag="span">
              <template #fps>
                <span class="text-foreground tabular-nums mx-1">{{ avgFpsText }}</span>
              </template>
            </i18n-t>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
