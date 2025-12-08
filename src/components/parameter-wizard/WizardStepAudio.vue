<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AudioConfig } from "@/types";

const { audio, isCopyEncoder, t } = defineProps<{
  audio: AudioConfig;
  isCopyEncoder: boolean;
  t: (key: string, params?: any) => string | unknown;
}>();

const emit = defineEmits<{
  (e: "update-audio", value: Partial<AudioConfig>): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="bg-muted/40 p-4 rounded-md border border-border/60">
      <h3 class="font-semibold mb-4 border-b border-border/60 pb-2">
        {{ t("presetEditor.audio.title") }}
      </h3>
      <div class="space-y-4">
        <div class="flex gap-4">
          <Button
            :variant="audio.codec === 'copy' ? 'default' : 'outline'"
            class="flex-1 flex flex-col items-start gap-1 h-auto"
            @click="emit('update-audio', { codec: 'copy' })"
          >
            <span class="block font-bold">
              {{ t("presetEditor.audio.copyTitle") }}
            </span>
            <span class="text-xs text-muted-foreground">
              {{ t("presetEditor.audio.copyDesc") }}
            </span>
          </Button>
          <Button
            :variant="audio.codec === 'aac' ? 'default' : 'outline'"
            class="flex-1 flex flex-col items-start gap-1 h-auto"
            :disabled="isCopyEncoder"
            :aria-disabled="isCopyEncoder"
            @click="
              emit('update-audio', {
                codec: 'aac',
                // When switching to AAC, prefer a high-quality default and enable
                // international loudness normalization out of the box.
                bitrate: 320,
                loudnessProfile: 'ebuR128',
              })
            "
          >
            <span class="block font-bold">
              {{ t("presetEditor.audio.aacTitle") }}
            </span>
            <span class="text-xs text-muted-foreground">
              {{ t("presetEditor.audio.aacDesc") }}
            </span>
          </Button>
        </div>
        <div v-if="audio.codec === 'aac'">
          <Label class="block text-xs mb-1">
            {{ t("presetEditor.audio.bitrateLabel") }}
          </Label>
          <Select
            :model-value="String(audio.bitrate)"
            @update:model-value="(value) => emit('update-audio', { bitrate: Number(value as string) })"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="128">
                {{ t("presetEditor.audio.bitrate128") }}
              </SelectItem>
              <SelectItem value="192">
                {{ t("presetEditor.audio.bitrate192") }}
              </SelectItem>
              <SelectItem value="320">
                {{ t("presetEditor.audio.bitrate320") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="mt-1 text-[11px] text-muted-foreground">
            {{ t("presetEditor.audio.bitrateHelp") }}
          </p>
        </div>

        <div v-if="audio.codec === 'aac'" class="space-y-2">
          <Label class="block text-xs">
            {{ t("presetEditor.audio.loudnessProfileLabel") }}
          </Label>
          <div class="grid grid-cols-3 gap-2">
            <Button
              :variant="!audio.loudnessProfile || audio.loudnessProfile === 'none' ? 'default' : 'outline'"
              class="h-8 px-2 text-[11px]"
              @click="emit('update-audio', { loudnessProfile: 'none' })"
            >
              {{ t("presetEditor.audio.loudnessNone") }}
            </Button>
            <Button
              :variant="audio.loudnessProfile === 'cnBroadcast' ? 'default' : 'outline'"
              class="h-8 px-2 text-[11px]"
              @click="emit('update-audio', { loudnessProfile: 'cnBroadcast' })"
            >
              {{ t("presetEditor.audio.loudnessCnBroadcast") }}
            </Button>
            <Button
              :variant="audio.loudnessProfile === 'ebuR128' ? 'default' : 'outline'"
              class="h-8 px-2 text-[11px]"
              @click="emit('update-audio', { loudnessProfile: 'ebuR128' })"
            >
              {{ t("presetEditor.audio.loudnessEbuR128") }}
            </Button>
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground">
            {{ t("presetEditor.audio.loudnessHelp") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
