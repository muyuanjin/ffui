<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PresetTemplateValidationStatus from "@/components/preset-template/PresetTemplateValidationStatus.vue";
import type { HighlightToken } from "@/lib/highlightTokens";
import type { AudioConfig, FilterConfig, VideoConfig, Translate } from "@/types";
import type { PresetTemplateValidationResult } from "@/types";

const {
  video,
  audio,
  filters,
  advancedEnabled,
  ffmpegTemplate,
  highlightedCommandTokens,
  parseHint,
  parseHintClass,
  t,
  showSummary = true,
  showToggle = true,
  quickValidateBusy = false,
  quickValidateResult = null,
  showQuickValidate = true,
} = defineProps<{
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  advancedEnabled: boolean;
  ffmpegTemplate: string;
  highlightedCommandTokens: HighlightToken[];
  parseHint: string | null;
  parseHintClass: string;
  t: Translate;
  showSummary?: boolean;
  showToggle?: boolean;
  quickValidateBusy?: boolean;
  quickValidateResult?: PresetTemplateValidationResult | null;
  showQuickValidate?: boolean;
}>();

const emit = defineEmits<{
  (e: "update-advanced-enabled", value: boolean): void;
  (e: "update-template", value: string): void;
  (e: "parse-template"): void;
  (e: "copy-preview"): void;
  (e: "quick-validate"): void;
}>();

const quickValidateHover = ref(false);
const quickValidateButtonLabel = computed(() => {
  if (!showQuickValidate) return "";
  if (quickValidateHover.value) return t("presetEditor.advanced.quickValidateButton") as string;
  if (quickValidateBusy) return t("presetEditor.advanced.quickValidate.running") as string;

  const outcome = quickValidateResult?.outcome ?? null;
  if (!outcome) return t("presetEditor.advanced.quickValidateButton") as string;
  if (outcome === "ok") return t("presetEditor.advanced.quickValidate.ok") as string;
  if (outcome === "failed") return t("presetEditor.advanced.quickValidate.failed") as string;
  if (outcome === "timedOut") return t("presetEditor.advanced.quickValidate.timedOut") as string;
  if (outcome === "skippedToolUnavailable") return t("presetEditor.advanced.quickValidate.toolMissing") as string;
  if (outcome === "templateInvalid") return t("presetEditor.advanced.quickValidate.templateInvalid") as string;
  return t("presetEditor.advanced.quickValidate.failed") as string;
});

const quickValidateButtonToneClass = computed(() => {
  if (quickValidateHover.value) return "";
  if (quickValidateBusy) return "";
  const outcome = quickValidateResult?.outcome ?? null;
  if (!outcome) return "";
  if (outcome === "ok") return "text-emerald-400";
  if (outcome === "skippedToolUnavailable" || outcome === "templateInvalid") return "text-amber-400";
  return "text-destructive";
});
</script>

<template>
  <div class="space-y-6">
    <div v-if="showSummary" class="bg-muted/40 p-4 rounded-md border border-border/60">
      <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
        {{ t("presetEditor.summary.title") }}
      </h3>
      <div class="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div class="text-[10px] text-muted-foreground uppercase mb-1">
            {{ t("presets.videoLabel") }}
          </div>
          <div class="font-mono text-foreground">
            {{ video.encoder }} · {{ video.rateControl.toUpperCase() }} {{ video.qualityValue }}
          </div>
        </div>
        <div>
          <div class="text-[10px] text-muted-foreground uppercase mb-1">
            {{ t("presets.audioLabel") }}
          </div>
          <div class="font-mono text-foreground">
            <span v-if="audio.codec === 'copy'">
              {{ t("presets.audioCopy") }}
            </span>
            <span v-else> AAC {{ audio.bitrate ?? 0 }}k </span>
          </div>
        </div>
        <div v-if="filters.scale">
          <div class="text-[10px] text-muted-foreground uppercase mb-1">
            {{ t("presetEditor.filters.title") }}
          </div>
          <div class="font-mono text-foreground">scale={{ filters.scale }}</div>
        </div>
      </div>
    </div>

    <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-semibold">
            {{ t("presetEditor.advanced.title") }}
          </h3>
          <p class="text-xs text-muted-foreground mt-1">
            {{ t("presetEditor.advanced.description") }}
          </p>
          <p v-if="advancedEnabled && ffmpegTemplate.trim().length > 0" class="text-xs text-amber-400 mt-1">
            {{ t("presetEditor.advanced.customPresetHint") }}
          </p>
        </div>
        <Label v-if="showToggle" class="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            :checked="advancedEnabled"
            @update:checked="(value) => emit('update-advanced-enabled', Boolean(value))"
          />
          <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
        </Label>
      </div>

      <div class="space-y-1">
        <Label class="text-xs">
          {{ t("presetEditor.advanced.templateLabel") }}
        </Label>
        <Textarea
          :model-value="ffmpegTemplate"
          :placeholder="t('presetEditor.advanced.templatePlaceholder')"
          class="min-h-[80px] text-xs font-mono"
          @update:model-value="(value) => emit('update-template', value as string)"
        />
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">
            {{ t("presetEditor.advanced.previewTitle") }}
          </span>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="xs"
              class="text-[11px] whitespace-normal h-auto leading-snug"
              @click="emit('parse-template')"
            >
              {{ t("presetEditor.advanced.parseButton") }}
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="text-[11px] whitespace-normal h-auto leading-snug"
              @click="emit('copy-preview')"
            >
              {{ t("presetEditor.advanced.copyButton") }}
            </Button>
            <Button
              v-if="showQuickValidate"
              variant="outline"
              size="xs"
              class="text-[11px] whitespace-normal h-auto leading-snug"
              :class="quickValidateButtonToneClass"
              :disabled="quickValidateBusy || !advancedEnabled || ffmpegTemplate.trim().length === 0"
              @mouseenter="quickValidateHover = true"
              @mouseleave="quickValidateHover = false"
              @click="emit('quick-validate')"
            >
              {{ quickValidateButtonLabel }}
            </Button>
          </div>
        </div>
        <pre
          class="mt-1 rounded-md bg-background/80 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
        ><span
          v-for="(token, idx) in highlightedCommandTokens"
          :key="idx"
          :class="token.className"
          :title="token.title"
          v-text="token.text"
        ></span></pre>
        <p :class="parseHintClass" class="mt-1">
          {{ parseHint || (t("presetEditor.advanced.templateHint") as string) }}
        </p>
        <p v-if="showQuickValidate" class="mt-1 text-[10px] text-muted-foreground">
          {{ t("presetEditor.advanced.quickValidateScope") }}
        </p>
        <PresetTemplateValidationStatus
          v-if="showQuickValidate && quickValidateResult && quickValidateResult.outcome !== 'ok'"
          :busy="quickValidateBusy"
          :result="quickValidateResult"
        />
      </div>
    </div>
  </div>
</template>
