<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { FFmpegPreset } from "@/types";

const props = defineProps<{
  filteredPresets: FFmpegPreset[];
  selectedIds: Set<string>;
  resolveDescription: (preset: FFmpegPreset) => string;
  getPresetScenarioLabel: (preset: FFmpegPreset) => string;
  getPresetRiskBadge: (preset: FFmpegPreset) => string | null;
}>();

const emit = defineEmits<{
  (e: "toggle", id: string): void;
  (e: "selectAll"): void;
  (e: "deselectAll"): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="space-y-4" data-testid="preset-setup-wizard-step-presets">
    <div class="flex items-center justify-between mb-2">
      <div>
        <h3 class="text-lg font-bold">{{ t("onboarding.presetsTitle") }}</h3>
        <p class="text-muted-foreground text-xs">
          {{ t("onboarding.presetsDescription", { count: props.filteredPresets.length }) }}
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="emit('selectAll')">{{
          t("onboarding.selectAll")
        }}</Button>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="emit('deselectAll')">{{
          t("onboarding.deselectAll")
        }}</Button>
      </div>
    </div>

    <div v-if="props.filteredPresets.length === 0" class="text-center py-8 text-muted-foreground">
      {{ t("onboarding.noPresetsMatch") }}
    </div>

    <div v-else class="grid grid-cols-1 gap-2 max-h-[40vh] overflow-y-auto pr-1">
      <Card
        v-for="preset in props.filteredPresets"
        :key="preset.id"
        data-testid="preset-setup-wizard-preset-card"
        :class="[
          'cursor-pointer transition-all',
          props.selectedIds.has(preset.id) ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/50',
        ]"
        @click="emit('toggle', preset.id)"
      >
        <CardContent class="p-3 flex items-center gap-3">
          <Checkbox :checked="props.selectedIds.has(preset.id)" class="pointer-events-none" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium truncate">{{ preset.name }}</h4>
              <span class="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 bg-muted rounded">{{
                preset.video.encoder
              }}</span>
            </div>
            <p class="text-xs text-muted-foreground truncate mt-0.5">
              {{ props.resolveDescription(preset) }}
            </p>
            <div class="mt-0.5 flex items-center flex-wrap gap-1">
              <span class="text-[10px] text-muted-foreground">
                {{ t("presetEditor.panel.scenarioLabel") }}：
                <span class="text-[10px] text-foreground">
                  {{ props.getPresetScenarioLabel(preset) }}
                </span>
              </span>
              <span
                v-if="props.getPresetRiskBadge(preset)"
                class="inline-flex items-center rounded-full border border-amber-500/50 text-amber-500 px-1.5 py-0.5 text-[9px] font-medium"
              >
                {{ props.getPresetRiskBadge(preset) }}
              </span>
            </div>
          </div>
          <div class="text-xs text-muted-foreground text-right shrink-0">
            <div>{{ preset.video.rateControl.toUpperCase() }} {{ preset.video.qualityValue }}</div>
            <div class="text-[10px]">{{ preset.audio.codec.toUpperCase() }}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
