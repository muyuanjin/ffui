<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AudioConfig, FilterConfig, VideoConfig } from "@/types";

const { video, audio, filters, advancedEnabled, ffmpegTemplate, highlightedCommandHtml, parseHint, parseHintClass, t } =
  defineProps<{
    video: VideoConfig;
    audio: AudioConfig;
    filters: FilterConfig;
    advancedEnabled: boolean;
    ffmpegTemplate: string;
    highlightedCommandHtml: string;
    parseHint: string | null;
    parseHintClass: string;
    t: (key: string, params?: any) => string | unknown;
  }>();

const emit = defineEmits<{
  (e: "update-advanced-enabled", value: boolean): void;
  (e: "update-template", value: string): void;
  (e: "parse-template"): void;
  (e: "copy-preview"): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="bg-muted/40 p-4 rounded-md border border-border/60">
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
        <Label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
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
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              class="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              @click="emit('parse-template')"
            >
              {{ t("presetEditor.advanced.parseButton") }}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              @click="emit('copy-preview')"
            >
              {{ t("presetEditor.advanced.copyButton") }}
            </Button>
          </div>
        </div>
        <pre
          class="mt-1 rounded-md bg-background/80 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
          v-html="highlightedCommandHtml"
        />
        <p :class="parseHintClass" class="mt-1">
          {{ parseHint || (t("presetEditor.advanced.templateHint") as string) }}
        </p>
      </div>
    </div>
  </div>
</template>
