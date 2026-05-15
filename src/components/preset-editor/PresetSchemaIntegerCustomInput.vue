<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

defineProps<{
  id: string;
  modelValue: string;
  min: number;
  error: string;
  disabled: boolean;
  commandGroupAttr?: string;
  commandFieldAttr?: string;
  fixLabel: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: unknown): void;
  (e: "fix"): void;
}>();
</script>

<template>
  <Input
    :id="id"
    :model-value="modelValue"
    type="number"
    step="1"
    :min="String(min)"
    class="h-9 text-xs"
    :disabled="disabled"
    :class="error ? 'border-destructive focus-visible:ring-destructive/30' : ''"
    :data-command-group="commandGroupAttr"
    :data-command-field="commandFieldAttr"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <div v-if="error" class="flex items-center justify-between gap-2">
    <p class="text-[10px] text-destructive">
      {{ error }}
    </p>
    <Button type="button" variant="ghost" size="xs" class="h-6 px-2 text-[10px]" @click="emit('fix')">
      {{ fixLabel }}
    </Button>
  </div>
</template>
