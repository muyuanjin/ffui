<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PresetSchemaSelectOption } from "./presetSchemaFieldShared";

defineProps<{
  modelValue: string;
  disabled: boolean;
  triggerLabel: string;
  options: PresetSchemaSelectOption[];
  testId?: string;
  commandGroupAttr?: string;
  commandFieldAttr?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: unknown): void;
}>();
</script>

<template>
  <Select :model-value="modelValue" :disabled="disabled" @update:model-value="emit('update:modelValue', $event)">
    <SelectTrigger
      class="h-9 text-xs"
      :data-testid="testId"
      :data-command-group="commandGroupAttr"
      :data-command-field="commandFieldAttr"
    >
      <SelectValue>{{ triggerLabel }}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
