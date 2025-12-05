<script setup lang="ts">
import type { AudioConfig, SubtitlesConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  audio: AudioConfig;
  subtitles: SubtitlesConfig;
  isCopyEncoder: boolean;
}>();

const audio = props.audio as any;
const subtitles = props.subtitles as any;

const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div class="bg-muted/40 p-4 rounded-md border border-border/60">
      <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
        {{ t("presetEditor.audio.title") }}
      </h3>
      <div class="space-y-4">
        <div class="flex gap-4">
          <Button
            :variant="audio.codec === 'copy' ? 'default' : 'outline'"
            class="flex-1 flex flex-col items-start gap-1 h-auto"
            @click="audio.codec = 'copy'"
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
            :disabled="props.isCopyEncoder"
            :aria-disabled="props.isCopyEncoder"
            @click="audio.codec = 'aac'"
          >
            <span class="block font-bold">
              {{ t("presetEditor.audio.aacTitle") }}
            </span>
            <span class="text-xs text-muted-foreground">
              {{ t("presetEditor.audio.aacDesc") }}
            </span>
          </Button>
        </div>

        <div
          v-if="audio.codec === 'aac'"
          class="space-y-3"
        >
          <div>
            <Label class="block text-xs mb-1">
              {{ t("presetEditor.audio.bitrateLabel") }}
            </Label>
            <Select
              :model-value="audio.bitrate != null ? String(audio.bitrate) : ''"
              @update:model-value="
                (value) => {
                  const parsed = Number(value as string);
                  audio.bitrate = Number.isNaN(parsed) ? undefined : parsed;
                }
              "
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

          <div class="space-y-2">
            <Label class="block text-xs">
              {{ t("presetEditor.audio.loudnessProfileLabel") }}
            </Label>
            <div class="grid grid-cols-3 gap-2">
              <Button
                :variant="!audio.loudnessProfile || audio.loudnessProfile === 'none' ? 'default' : 'outline'"
                class="h-8 px-2 text-[11px]"
                @click="audio.loudnessProfile = 'none'"
              >
                {{ t("presetEditor.audio.loudnessNone") }}
              </Button>
              <Button
                :variant="audio.loudnessProfile === 'cnBroadcast' ? 'default' : 'outline'"
                class="h-8 px-2 text-[11px]"
                @click="audio.loudnessProfile = 'cnBroadcast'"
              >
                {{ t("presetEditor.audio.loudnessCnBroadcast") }}
              </Button>
              <Button
                :variant="audio.loudnessProfile === 'ebuR128' ? 'default' : 'outline'"
                class="h-8 px-2 text-[11px]"
                @click="audio.loudnessProfile = 'ebuR128'"
              >
                {{ t("presetEditor.audio.loudnessEbuR128") }}
              </Button>
            </div>
            <p class="mt-1 text-[11px] text-muted-foreground">
              {{ t("presetEditor.audio.loudnessHelp") }}
            </p>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.sampleRateLabel") }}
              </Label>
              <Select
                :model-value="audio.sampleRateHz ? String(audio.sampleRateHz) : ''"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string);
                    audio.sampleRateHz = Number.isNaN(parsed) ? undefined : parsed;
                  }
                "
              >
                <SelectTrigger class="h-8 text-xs">
                  <SelectValue
                    :placeholder="t('presetEditor.audio.sampleRatePlaceholder')"
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="44100">44100</SelectItem>
                  <SelectItem value="48000">48000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.channelsLabel") }}
              </Label>
              <Select
                :model-value="audio.channels ? String(audio.channels) : ''"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string);
                    audio.channels = Number.isNaN(parsed) ? undefined : parsed;
                  }
                "
              >
                <SelectTrigger class="h-8 text-xs">
                  <SelectValue
                    :placeholder="t('presetEditor.audio.channelsPlaceholder')"
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.layoutLabel") }}
              </Label>
              <Input
                :model-value="audio.channelLayout ?? ''"
                :placeholder="t('presetEditor.audio.layoutPlaceholder')"
                class="h-8 text-xs"
                @update:model-value="
                  (value) => {
                    const v = String(value ?? '');
                    audio.channelLayout = v || undefined;
                  }
                "
              />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.targetLufsLabel") }}
              </Label>
              <Input
                type="number"
                step="0.1"
                class="h-8 text-xs"
                :model-value="audio.targetLufs != null ? String(audio.targetLufs) : ''"
                :placeholder="audio.loudnessProfile === 'cnBroadcast' ? '-24' : audio.loudnessProfile === 'ebuR128' ? '-23' : ''"
                @update:model-value="
                  (value) => {
                    const n = Number(value ?? '');
                    audio.targetLufs = Number.isFinite(n) ? n : undefined;
                  }
                "
              />
            </div>

            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.loudnessRangeLabel") }}
              </Label>
              <Input
                type="number"
                step="0.1"
                class="h-8 text-xs"
                :model-value="audio.loudnessRange != null ? String(audio.loudnessRange) : ''"
                :placeholder="'7'"
                @update:model-value="
                  (value) => {
                    const n = Number(value ?? '');
                    audio.loudnessRange = Number.isFinite(n) ? n : undefined;
                  }
                "
              />
            </div>

            <div class="space-y-1">
              <Label class="block text-xs">
                {{ t("presetEditor.audio.truePeakDbLabel") }}
              </Label>
              <Input
                type="number"
                step="0.1"
                class="h-8 text-xs"
                :model-value="audio.truePeakDb != null ? String(audio.truePeakDb) : ''"
                :placeholder="audio.loudnessProfile === 'cnBroadcast' ? '-2' : audio.loudnessProfile === 'ebuR128' ? '-1' : ''"
                @update:model-value="
                  (value) => {
                    const n = Number(value ?? '');
                    audio.truePeakDb = Number.isFinite(n) ? n : undefined;
                  }
                "
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-muted/40 p-4 rounded-md border border-border/60">
      <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
        {{ t("presetEditor.panel.subtitlesTitle") }}
      </h3>
      <div class="space-y-3">
        <div class="space-y-1">
          <Label class="text-xs">
            {{ t("presetEditor.panel.subtitlesStrategyLabel") }}
          </Label>
          <Select
            :model-value="subtitles.strategy ?? 'keep'"
            @update:model-value="(value) => { subtitles.strategy = value as any; }"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">
                {{ t("presetEditor.panel.subtitlesKeep") }}
              </SelectItem>
              <SelectItem value="drop">
                {{ t("presetEditor.panel.subtitlesDrop") }}
              </SelectItem>
              <SelectItem value="burn_in">
                {{ t("presetEditor.panel.subtitlesBurnIn") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          v-if="subtitles.strategy === 'burn_in'"
          class="space-y-1"
        >
          <Label class="text-xs">
            {{ t("presetEditor.panel.subtitlesBurnInFilterLabel") }}
          </Label>
          <Input
            :model-value="subtitles.burnInFilter ?? ''"
            :placeholder="
              t(
                'presetEditor.panel.subtitlesBurnInFilterPlaceholder',
              )
            "
            class="h-8 text-xs font-mono"
            @update:model-value="
              (value) => {
                const v = String(value ?? '');
                subtitles.burnInFilter = v || undefined;
              }
            "
          />
          <p class="text-[11px] text-muted-foreground">
            {{ t("presetEditor.panel.subtitlesBurnInHelp") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
