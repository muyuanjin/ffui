<script setup lang="ts">
import type { CSSProperties } from "vue";
import WipeHandle from "./WipeHandle.vue";

const props = defineProps<{
  modelValue: number;
  transformStyle: CSSProperties;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();
</script>

<template>
  <div class="absolute inset-0 overflow-hidden">
    <div
      class="absolute inset-0 overflow-hidden"
      :style="{ clipPath: `inset(0 ${100 - props.modelValue}% 0 0)` }"
      data-testid="job-compare-wipe-layer-input"
    >
      <div class="absolute inset-0" :style="props.transformStyle" data-testid="job-compare-transform-wipe-input">
        <slot name="input" />
      </div>
    </div>

    <div
      class="absolute inset-0 overflow-hidden"
      :style="{ clipPath: `inset(0 0 0 ${props.modelValue}%)` }"
      data-testid="job-compare-wipe-layer-output"
    >
      <div class="absolute inset-0" :style="props.transformStyle" data-testid="job-compare-transform-wipe-output">
        <slot name="output" />
      </div>
    </div>

    <div
      class="absolute inset-y-0 w-[2px] bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] z-10 pointer-events-none"
      :style="{ left: `${props.modelValue}%`, transform: 'translateX(-50%)' }"
      data-testid="job-compare-wipe-divider"
    />

    <WipeHandle :model-value="props.modelValue" @update:model-value="(v) => emit('update:modelValue', v)" />
  </div>
</template>
