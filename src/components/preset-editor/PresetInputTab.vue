<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, DurationMode, InputTimelineConfig, SeekMode } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";

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
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.inputTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.seekModeLabel") }}
        </Label>
        <Select
          :model-value="inputTimeline.seekMode ?? 'output'"
          @update:model-value="
            (value) => {
              inputTimeline.seekMode = value as SeekMode;
            }
          "
        >
          <SelectTrigger class="h-9 text-xs" data-testid="preset-input-seek-mode-trigger">
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
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.seekPositionLabel") }}
        </Label>
        <Input
          :model-value="inputTimeline.seekPosition ?? ''"
          :placeholder="t('presetEditor.panel.seekPositionPlaceholder')"
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
      <div class="">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.durationModeLabel") }}
        </Label>
        <Select
          :model-value="inputTimeline.durationMode ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              inputTimeline.durationMode = (v || undefined) as DurationMode | undefined;
            }
          "
        >
          <SelectTrigger class="h-9 text-xs" data-testid="preset-input-duration-mode-trigger">
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
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.durationLabel") }}
        </Label>
        <Input
          :model-value="inputTimeline.duration ?? ''"
          :placeholder="t('presetEditor.panel.durationPlaceholder')"
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
      <Checkbox v-model:checked="accurateSeekChecked" class="h-3 w-3 border-border bg-background" />
      <span>
        {{ t("presetEditor.panel.accurateSeekLabel") }}
      </span>
    </label>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.inputHelp") }}
    </p>
  </div>
</template>
