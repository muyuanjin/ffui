<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import type { BatchCompressConfig } from "@/types";

type SavingConditionType = BatchCompressConfig["savingConditionType"];

defineProps<{
  savingConditionType: SavingConditionType;
  minSavingRatio: number;
  minSavingAbsoluteMb: number;
}>();

const emit = defineEmits<{
  (e: "update:savingConditionType", value: SavingConditionType): void;
  (e: "update:minSavingRatio", value: number): void;
  (e: "update:minSavingAbsoluteMb", value: number): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
    <h3 class="text-sm font-bold flex items-center gap-2">
      <span class="text-blue-400">▣</span>
      {{ t("batchCompress.savingCondition") }}
    </h3>

    <RadioGroup
      class="flex gap-4"
      :model-value="savingConditionType"
      @update:model-value="(v) => emit('update:savingConditionType', v as SavingConditionType)"
    >
      <label class="flex items-center gap-2 cursor-pointer">
        <RadioGroupItem value="ratio" class="h-4 w-4 border-border/50" />
        <span class="text-xs">{{ t("batchCompress.savingByRatio") }}</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <RadioGroupItem value="absoluteSize" class="h-4 w-4 border-border/50" />
        <span class="text-xs">{{ t("batchCompress.savingByAbsolute") }}</span>
      </label>
    </RadioGroup>

    <div v-if="savingConditionType === 'ratio'" class="space-y-2">
      <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.minSavingRatioLabel") }}</Label>
      <div class="flex items-center gap-4">
        <Slider
          :min="0.5"
          :max="0.99"
          :step="0.01"
          :model-value="[minSavingRatio]"
          class="flex-1"
          @update:model-value="(v) => emit('update:minSavingRatio', (v as number[])[0] ?? 0)"
        />
        <span class="text-emerald-400 font-mono font-bold w-12 text-right text-sm">
          {{ (minSavingRatio * 100).toFixed(0) }}%
        </span>
      </div>
      <p class="text-[10px] text-muted-foreground">
        {{ t("batchCompress.minSavingRatioHelp", { ratio: (minSavingRatio * 100).toFixed(0) }) }}
      </p>
    </div>

    <div v-else class="space-y-2">
      <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.minSavingAbsoluteLabel") }}</Label>
      <div class="flex items-center gap-2">
        <Input
          type="number"
          :model-value="minSavingAbsoluteMb"
          class="w-24 h-8 text-sm"
          @update:model-value="(v) => emit('update:minSavingAbsoluteMb', Number(v))"
        />
        <span class="text-xs text-muted-foreground">MB</span>
      </div>
      <p class="text-[10px] text-muted-foreground">
        {{ t("batchCompress.minSavingAbsoluteHelp", { size: minSavingAbsoluteMb }) }}
      </p>
    </div>
  </div>
</template>
