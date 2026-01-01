<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PresetRadarChart from "@/components/preset-editor/PresetRadarChart.vue";

const props = defineProps<{
  activeTab: string;
  currentInsights: any;
  currentPresetSnapshot: any;
  allPresets?: any;
  highlightedCommandTokens: any[];
  parseHint: string | null;
  parseHintClass: string;
  copyHint: string | null;
  advancedEnabled: boolean;
  ffmpegTemplate: string;
  isTokenFocused: (token: any) => boolean;
  onPreviewTokenClick: (token: any) => void;
  onCopyCommand: () => void | Promise<void>;
  onCopyTemplate: () => void | Promise<void>;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="w-80 border-l border-border/60 bg-muted/40 p-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
    <div class="space-y-2 flex-shrink-0">
      <PresetRadarChart
        :metrics="props.currentInsights.radar"
        :has-stats="props.currentInsights.hasStats"
        :preset="props.currentPresetSnapshot"
        :all-presets="props.allPresets"
      />
      <div class="text-[11px] text-muted-foreground space-y-1">
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.scenarioLabel") }}: </span>
          <span class="ml-1">
            {{ t(`presetEditor.panel.scenario.${props.currentInsights.scenario}`) }}
          </span>
        </div>
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.encoderFamilyLabel") }}: </span>
          <span class="ml-1">
            {{ t(`presetEditor.panel.encoderFamily.${props.currentInsights.encoderFamily}`) }}
          </span>
        </div>
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.beginnerFriendlyLabel") }}: </span>
          <span class="ml-1">
            {{
              props.currentInsights.isBeginnerFriendly
                ? t("presetEditor.panel.beginnerFriendlyYes")
                : t("presetEditor.panel.beginnerFriendlyNo")
            }}
          </span>
        </div>
        <p v-if="props.currentInsights.mayIncreaseSize" class="text-[11px] text-amber-400">
          {{ t("presetEditor.panel.mayIncreaseSizeWarning") }}
        </p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 border-b border-border/60 pb-2 mt-2 flex-shrink-0">
      <h3 class="text-xs font-semibold text-foreground">
        {{ t("presetEditor.advanced.previewTitle") }}
      </h3>
      <div class="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" class="h-7 px-2 text-[11px]" @click="props.onCopyCommand">
          {{ t("presetEditor.advanced.copyCommandButton") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="props.ffmpegTemplate.trim().length === 0"
          @click="props.onCopyTemplate"
        >
          {{ t("presetEditor.advanced.copyTemplateButton") }}
        </Button>
      </div>
    </div>
    <p v-if="props.copyHint" class="text-[10px] text-muted-foreground flex-shrink-0">
      {{ props.copyHint }}
    </p>
    <pre
      class="flex-1 min-h-[80px] rounded-md bg-background/90 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
      :data-active-group="props.activeTab"
    ><span
      v-for="(token, idx) in props.highlightedCommandTokens"
      :key="idx"
      :class="[
        token.className,
        token.group ? 'cursor-pointer hover:bg-muted/20 rounded-sm' : '',
        props.isTokenFocused(token) ? 'bg-primary/15 text-foreground rounded-sm' : '',
      ]"
      :title="token.title"
      :data-group="token.group"
      :data-field="token.field"
      @click="props.onPreviewTokenClick(token)"
      v-text="token.text"
    ></span></pre>
    <p :class="[props.parseHintClass, 'flex-shrink-0']">
      {{ props.parseHint || (t("presetEditor.advanced.templateHint") as string) }}
    </p>
    <p
      v-if="props.advancedEnabled && props.ffmpegTemplate.trim().length > 0"
      class="text-[11px] text-amber-400 flex-shrink-0"
    >
      {{ t("presetEditor.advanced.customPresetHint") }}
    </p>
    <div class="space-y-1 mt-2 flex-shrink-0">
      <Label class="text-[11px]">
        {{ t("presetEditor.advanced.templateLabel") }}
      </Label>
      <Textarea
        :model-value="props.ffmpegTemplate"
        readonly
        :placeholder="t('presetEditor.advanced.templatePlaceholder')"
        class="min-h-[60px] text-[11px] font-mono"
      />
    </div>
  </div>
</template>
