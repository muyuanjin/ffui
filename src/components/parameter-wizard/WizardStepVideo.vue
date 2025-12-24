<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import type { EncoderType, VideoConfig, Translate } from "@/types";

const { video, encoderOptions, presetOptions, rateControlLabel, isCopyEncoder, t } = defineProps<{
  video: VideoConfig;
  encoderOptions: { value: EncoderType; label: string }[];
  presetOptions: Record<string, string[]>;
  rateControlLabel: string;
  isCopyEncoder: boolean;
  t: Translate;
}>();

const emit = defineEmits<{
  (e: "change-encoder", value: EncoderType): void;
  (e: "update-video", payload: Partial<VideoConfig>): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <Label>{{ t("presetEditor.video.encoder") }}</Label>
      <Select
        :model-value="video.encoder"
        @update:model-value="(value) => emit('change-encoder', value as EncoderType)"
      >
        <SelectTrigger>
          <SelectValue :placeholder="t('presetEditor.video.encoderPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt in encoderOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="isCopyEncoder" class="text-amber-400 text-xs mt-1 flex items-center gap-1">
        {{ t("presetEditor.video.copyWarning") }}
      </p>
    </div>

    <div v-if="!isCopyEncoder" class="space-y-6">
      <div class="bg-muted/40 p-4 rounded-md border border-border/60">
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium">
            {{ rateControlLabel }}
          </span>
          <span class="text-primary font-bold text-lg">
            {{ video.qualityValue }}
          </span>
        </div>
        <Slider
          :min="0"
          :max="video.encoder === 'libsvtav1' ? 63 : 51"
          :step="1"
          :model-value="[video.qualityValue]"
          class="mt-3"
          @update:model-value="
            (value) => {
              const next = (value as number[])[0];
              if (typeof next === 'number') emit('update-video', { qualityValue: next });
            }
          "
        />
        <div class="mt-2 text-xs text-muted-foreground flex gap-2 items-start">
          <span class="text-primary mt-0.5">ℹ</span>
          <p>
            <span v-if="video.encoder === 'libx264'">
              {{ t("presetEditor.tips.crf_x264") }}
            </span>
            <span v-else-if="video.encoder === 'hevc_nvenc'">
              {{ t("presetEditor.tips.cq_nvenc") }}
            </span>
            <span v-else-if="video.encoder === 'libsvtav1'">
              {{ t("presetEditor.tips.crf_av1") }}
            </span>
          </p>
        </div>
      </div>

      <div class="space-y-1">
        <Label>{{ t("presetEditor.video.presetLabel") }}</Label>
        <Select
          :model-value="video.preset"
          @update:model-value="(value) => emit('update-video', { preset: value as string })"
        >
          <SelectTrigger data-testid="wizard-video-preset-trigger">
            <SelectValue>{{ video.preset }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in presetOptions[video.encoder]" :key="p" :value="p">
              {{ p }}
            </SelectItem>
          </SelectContent>
        </Select>
        <div class="mt-1 text-xs text-muted-foreground">
          <span v-if="video.encoder === 'libx264'">
            {{ t("presetEditor.tips.preset_x264") }}
          </span>
          <span v-else-if="video.encoder === 'hevc_nvenc'">
            {{ t("presetEditor.tips.preset_nvenc") }}
          </span>
          <span v-else-if="video.encoder === 'libsvtav1'">
            {{ t("presetEditor.tips.preset_av1") }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
