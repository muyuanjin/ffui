<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, DurationMode, InputTimelineConfig, SeekMode } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import type { LoopCountFieldDef, TimeExpressionFieldDef } from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  inputTimeline: InputTimelineConfig;
}>();

const inputTimeline: DeepWritable<InputTimelineConfig> = props.inputTimeline;

const accurateSeekChecked = computed<boolean>({
  get() {
    return inputTimeline.accurateSeek ?? false;
  },
  set(value) {
    inputTimeline.accurateSeek = value;
  },
});

const { t } = useI18n();

const seekModeLabel = computed(() => {
  const value = inputTimeline.seekMode ?? "output";
  const map: Record<SeekMode, string> = {
    output: t("presetEditor.panel.seekModeOutput"),
    input: t("presetEditor.panel.seekModeInput"),
  };
  return map[value] ?? "";
});

const durationModeLabel = computed(() => {
  const value = inputTimeline.durationMode;
  if (value === "duration") return t("presetEditor.panel.durationModeDuration");
  if (value === "to") return t("presetEditor.panel.durationModeTo");
  return "";
});

const streamLoopField: LoopCountFieldDef<DeepWritable<InputTimelineConfig>> = {
  id: "preset-stream-loop",
  kind: "loopCount",
  width: "half",
  labelKey: "presetEditor.panel.streamLoopLabel",
  helpKey: "presetEditor.panel.streamLoopHelp",
  commandField: "streamLoop",
  autoLabelKey: "presetEditor.panel.streamLoopModeAuto",
  noLoopLabelKey: "presetEditor.panel.streamLoopModeNoLoop",
  infiniteLabelKey: "presetEditor.panel.streamLoopModeInfinite",
  timesLabelKey: "presetEditor.panel.streamLoopModeTimes",
  getCount: (model) => model.streamLoop,
  setCount: (model, value) => {
    model.streamLoop = value;
  },
  defaultTimes: 1,
  quickTimes: [1, 2],
  testId: "preset-input-stream-loop-trigger",
};

const inputTimeOffsetField: TimeExpressionFieldDef<DeepWritable<InputTimelineConfig>> = {
  id: "preset-itsoffset",
  kind: "timeExpression",
  width: "half",
  labelKey: "presetEditor.panel.itsoffsetLabel",
  helpKey: "presetEditor.panel.itsoffsetHelp",
  placeholderKey: "presetEditor.panel.itsoffsetPlaceholder",
  commandField: "itsoffset",
  customOptionLabelKey: "presetEditor.panel.timeExpressionCustom",
  presets: [
    { value: "0", labelKey: "presetEditor.panel.timePreset.zero" },
    { value: "-0.5", labelKey: "presetEditor.panel.timePreset.minusHalfSecond" },
    { value: "0.5", labelKey: "presetEditor.panel.timePreset.plusHalfSecond" },
    { value: "-1", labelKey: "presetEditor.panel.timePreset.minusOneSecond" },
    { value: "1", labelKey: "presetEditor.panel.timePreset.plusOneSecond" },
  ],
  defaultCustomValue: "0.5",
  getValue: (model) => model.inputTimeOffset,
  setValue: (model, value) => {
    model.inputTimeOffset = value;
  },
  testId: "preset-input-itsoffset-trigger",
};
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.inputTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.seekModeLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.seekModeHelp')" />
        </div>
        <Select
          :model-value="inputTimeline.seekMode ?? 'output'"
          @update:model-value="
            (value) => {
              inputTimeline.seekMode = value as SeekMode;
            }
          "
        >
          <SelectTrigger
            class="h-9 text-xs"
            data-testid="preset-input-seek-mode-trigger"
            data-command-group="input"
            data-command-field="timeline"
          >
            <SelectValue>{{ seekModeLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="output">
              {{ t("presetEditor.panel.seekModeOutput") }}
            </SelectItem>
            <SelectItem value="input">
              {{ t("presetEditor.panel.seekModeInput") }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.seekPositionLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.seekPositionHelp')" />
        </div>
        <Input
          :model-value="inputTimeline.seekPosition ?? ''"
          :placeholder="t('presetEditor.panel.seekPositionPlaceholder')"
          data-command-group="input"
          data-command-field="timeline"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              inputTimeline.seekPosition = v || undefined;
            }
          "
        />
        <p class="text-[11px] text-muted-foreground">
          {{ t("presetEditor.panel.seekPositionHelp") }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <PresetSchemaField :field="streamLoopField" :model="inputTimeline" command-group="input" />
      <PresetSchemaField :field="inputTimeOffsetField" :model="inputTimeline" command-group="input" />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.durationModeLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.durationModeHelp')" />
        </div>
        <Select
          :model-value="inputTimeline.durationMode ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              inputTimeline.durationMode = (v || undefined) as DurationMode | undefined;
            }
          "
        >
          <SelectTrigger
            class="h-9 text-xs"
            data-testid="preset-input-duration-mode-trigger"
            data-command-group="input"
            data-command-field="timeline"
          >
            <SelectValue>{{ durationModeLabel || t("presetEditor.panel.durationModePlaceholder") }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="duration">
              {{ t("presetEditor.panel.durationModeDuration") }}
            </SelectItem>
            <SelectItem value="to">
              {{ t("presetEditor.panel.durationModeTo") }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.durationLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.durationHelp')" />
        </div>
        <Input
          :model-value="inputTimeline.duration ?? ''"
          :placeholder="t('presetEditor.panel.durationPlaceholder')"
          data-command-group="input"
          data-command-field="timeline"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              inputTimeline.duration = v || undefined;
            }
          "
        />
      </div>
    </div>

    <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      <Checkbox
        v-model:checked="accurateSeekChecked"
        class="h-3 w-3 border-border bg-background"
        data-command-group="input"
        data-command-field="accurateSeek"
      />
      <span>
        {{ t("presetEditor.panel.accurateSeekLabel") }}
      </span>
      <HelpTooltipIcon :text="t('presetEditor.panel.accurateSeekHelp')" />
    </label>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.inputHelp") }}
    </p>
  </div>
</template>
