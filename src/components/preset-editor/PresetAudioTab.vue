<script setup lang="ts">
import { computed } from "vue";
import type { AudioConfig, DeepWritable, SubtitleStrategy, SubtitlesConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  audio: AudioConfig;
  subtitles: SubtitlesConfig;
  isCopyEncoder: boolean;
}>();

const audio: DeepWritable<AudioConfig> = props.audio;
const subtitles: DeepWritable<SubtitlesConfig> = props.subtitles;

const { t } = useI18n();

const bitrateLabel = computed(() => {
  const raw = audio.bitrate != null ? String(audio.bitrate) : "";
  const map: Record<string, string> = {
    "128": t("presetEditor.audio.bitrate128"),
    "192": t("presetEditor.audio.bitrate192"),
    "320": t("presetEditor.audio.bitrate320"),
  };
  return map[raw] ?? raw;
});

const subtitlesStrategyLabel = computed(() => {
  const value = (subtitles.strategy ?? "keep") as SubtitleStrategy;
  const map: Record<SubtitleStrategy, string> = {
    keep: t("presetEditor.panel.subtitlesKeep"),
    drop: t("presetEditor.panel.subtitlesDrop"),
    burn_in: t("presetEditor.panel.subtitlesBurnIn"),
  };
  return map[value] ?? "";
});
</script>

<template>
  <div class="space-y-3">
    <!-- 音频编码 -->
    <div class="bg-muted/40 p-3 rounded-md border border-border/60">
      <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
        {{ t("presetEditor.audio.title") }}
      </h3>
      <div class="">
        <div class="flex gap-2">
          <Button
            :variant="audio.codec === 'copy' ? 'default' : 'outline'"
            class="flex-1 flex flex-col items-start gap-1 h-auto"
            @click="audio.codec = 'copy'"
          >
            <span class="block font-bold text-xs">
              {{ t("presetEditor.audio.copyTitle") }}
            </span>
            <span class="text-[10px] text-muted-foreground">
              {{ t("presetEditor.audio.copyDesc") }}
            </span>
          </Button>
          <Button
            :variant="audio.codec === 'aac' ? 'default' : 'outline'"
            class="flex-1 flex flex-col items-start gap-1 h-auto"
            :disabled="props.isCopyEncoder"
            :aria-disabled="props.isCopyEncoder"
            @click="
              () => {
                audio.codec = 'aac';
                // 切换到 AAC 时，如果比特率为空，设置默认值
                if (audio.bitrate == null) {
                  audio.bitrate = 320;
                }
                // 如果响度配置为空，设置默认的国际标准
                if (!audio.loudnessProfile) {
                  audio.loudnessProfile = 'ebuR128';
                }
              }
            "
          >
            <span class="block font-bold text-xs">
              {{ t("presetEditor.audio.aacTitle") }}
            </span>
            <span class="text-[10px] text-muted-foreground">
              {{ t("presetEditor.audio.aacDesc") }}
            </span>
          </Button>
        </div>

        <div v-if="audio.codec === 'aac'" class="">
          <div class="grid grid-cols-3 gap-2">
            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.bitrateLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.bitrateHelp')" />
              </div>
              <Select
                :model-value="audio.bitrate != null ? String(audio.bitrate) : ''"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string);
                    audio.bitrate = Number.isNaN(parsed) ? undefined : parsed;
                  }
                "
              >
                <SelectTrigger class="h-9 text-xs" data-testid="preset-audio-bitrate-trigger">
                  <SelectValue>{{ bitrateLabel }}</SelectValue>
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
            </div>

            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.sampleRateLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.sampleRateHelp')" />
              </div>
              <Select
                :model-value="audio.sampleRateHz ? String(audio.sampleRateHz) : ''"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string);
                    audio.sampleRateHz = Number.isNaN(parsed) ? undefined : parsed;
                  }
                "
              >
                <SelectTrigger class="h-9 text-xs">
                  <SelectValue :placeholder="t('presetEditor.audio.sampleRatePlaceholder')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="44100">44100</SelectItem>
                  <SelectItem value="48000">48000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.channelsLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.channelsHelp')" />
              </div>
              <Select
                :model-value="audio.channels ? String(audio.channels) : ''"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string);
                    audio.channels = Number.isNaN(parsed) ? undefined : parsed;
                  }
                "
              >
                <SelectTrigger class="h-9 text-xs">
                  <SelectValue :placeholder="t('presetEditor.audio.channelsPlaceholder')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div class="flex items-center gap-1">
              <Label class="text-[10px] mb-1 block">
                {{ t("presetEditor.audio.loudnessProfileLabel") }}
              </Label>
              <HelpTooltipIcon :text="t('presetEditor.audio.loudnessHelp')" />
            </div>
            <div class="grid grid-cols-3 gap-2">
              <Button
                :variant="!audio.loudnessProfile || audio.loudnessProfile === 'none' ? 'default' : 'outline'"
                class="h-8 px-2 text-[10px]"
                @click="audio.loudnessProfile = 'none'"
              >
                {{ t("presetEditor.audio.loudnessNone") }}
              </Button>
              <Button
                :variant="audio.loudnessProfile === 'cnBroadcast' ? 'default' : 'outline'"
                class="h-8 px-2 text-[10px]"
                @click="audio.loudnessProfile = 'cnBroadcast'"
              >
                {{ t("presetEditor.audio.loudnessCnBroadcast") }}
              </Button>
              <Button
                :variant="audio.loudnessProfile === 'ebuR128' ? 'default' : 'outline'"
                class="h-8 px-2 text-[10px]"
                @click="audio.loudnessProfile = 'ebuR128'"
              >
                {{ t("presetEditor.audio.loudnessEbuR128") }}
              </Button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.targetLufsLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.targetLufsHelp')" />
              </div>
              <Input
                type="number"
                step="0.1"
                class="h-9 text-xs"
                :model-value="audio.targetLufs != null ? String(audio.targetLufs) : ''"
                :placeholder="
                  audio.loudnessProfile === 'cnBroadcast' ? '-24' : audio.loudnessProfile === 'ebuR128' ? '-23' : ''
                "
                @update:model-value="
                  (value) => {
                    const n = Number(value ?? '');
                    audio.targetLufs = Number.isFinite(n) ? n : undefined;
                  }
                "
              />
            </div>

            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.loudnessRangeLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.loudnessRangeHelp')" />
              </div>
              <Input
                type="number"
                step="0.1"
                class="h-9 text-xs"
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

            <div>
              <div class="flex items-center gap-1">
                <Label class="text-[10px] mb-1 block">
                  {{ t("presetEditor.audio.truePeakDbLabel") }}
                </Label>
                <HelpTooltipIcon :text="t('presetEditor.audio.truePeakDbHelp')" />
              </div>
              <Input
                type="number"
                step="0.1"
                class="h-9 text-xs"
                :model-value="audio.truePeakDb != null ? String(audio.truePeakDb) : ''"
                :placeholder="
                  audio.loudnessProfile === 'cnBroadcast' ? '-2' : audio.loudnessProfile === 'ebuR128' ? '-1' : ''
                "
                @update:model-value="
                  (value) => {
                    const n = Number(value ?? '');
                    audio.truePeakDb = Number.isFinite(n) ? n : undefined;
                  }
                "
              />
            </div>
          </div>

          <div>
            <div class="flex items-center gap-1">
              <Label class="text-[10px] mb-1 block">
                {{ t("presetEditor.audio.layoutLabel") }}
              </Label>
              <HelpTooltipIcon :text="t('presetEditor.audio.layoutHelp')" />
            </div>
            <Input
              :model-value="audio.channelLayout ?? ''"
              :placeholder="t('presetEditor.audio.layoutPlaceholder')"
              class="h-9 text-xs"
              @update:model-value="
                (value) => {
                  const v = String(value ?? '');
                  audio.channelLayout = v || undefined;
                }
              "
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 字幕设置 -->
    <div class="bg-muted/40 p-3 rounded-md border border-border/60">
      <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
        {{ t("presetEditor.panel.subtitlesTitle") }}
      </h3>
      <div class="">
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-[10px] mb-1 block">
              {{ t("presetEditor.panel.subtitlesStrategyLabel") }}
            </Label>
            <HelpTooltipIcon :text="t('presetEditor.panel.subtitlesStrategyHelp')" />
          </div>
          <Select
            :model-value="subtitles.strategy ?? 'keep'"
            @update:model-value="
              (value) => {
                subtitles.strategy = value as SubtitleStrategy;
              }
            "
          >
            <SelectTrigger class="h-9 text-xs" data-testid="preset-audio-subtitles-strategy-trigger">
              <SelectValue>{{ subtitlesStrategyLabel }}</SelectValue>
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

        <div v-if="subtitles.strategy === 'burn_in'">
          <div class="flex items-center gap-1">
            <Label class="text-[10px] mb-1 block">
              {{ t("presetEditor.panel.subtitlesBurnInFilterLabel") }}
            </Label>
            <HelpTooltipIcon :text="t('presetEditor.panel.subtitlesBurnInFilterHelp')" />
          </div>
          <Input
            :model-value="subtitles.burnInFilter ?? ''"
            :placeholder="t('presetEditor.panel.subtitlesBurnInFilterPlaceholder')"
            class="h-8 text-xs font-mono"
            @update:model-value="
              (value) => {
                const v = String(value ?? '');
                subtitles.burnInFilter = v || undefined;
              }
            "
          />
          <p class="text-[11px] text-muted-foreground mt-1">
            {{ t("presetEditor.panel.subtitlesBurnInHelp") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
