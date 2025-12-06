<script setup lang="ts">
import type { InputTimelineConfig } from "@/types";
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
  inputTimeline: InputTimelineConfig;
}>();

const inputTimeline = props.inputTimeline as any;

const { t } = useI18n();
</script>

<template>
  <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
    <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.inputTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label class="text-xs">
          {{ t("presetEditor.panel.seekModeLabel") }}
        </Label>
        <Select
          :model-value="inputTimeline.seekMode ?? 'output'"
          @update:model-value="(value) => { inputTimeline.seekMode = value as any; }"
        >
          <SelectTrigger class="h-8 text-xs">
            <SelectValue />
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

      <div class="space-y-2">
        <Label class="text-xs">
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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label class="text-xs">
          {{ t("presetEditor.panel.durationModeLabel") }}
        </Label>
        <Select
          :model-value="inputTimeline.durationMode ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              inputTimeline.durationMode = (v || undefined) as any;
            }
          "
        >
          <SelectTrigger class="h-8 text-xs">
            <SelectValue
              :placeholder="t('presetEditor.panel.durationModePlaceholder')"
            />
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

      <div class="space-y-2">
        <Label class="text-xs">
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
      <input
        v-model="inputTimeline.accurateSeek"
        type="checkbox"
        class="h-3 w-3 rounded border-border bg-background"
      />
      <span>
        {{ t("presetEditor.panel.accurateSeekLabel") }}
      </span>
    </label>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.inputHelp") }}
    </p>
  </div>
</template>
