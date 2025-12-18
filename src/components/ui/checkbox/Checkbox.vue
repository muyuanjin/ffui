<script setup lang="ts">
import type { CheckboxRootProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { Check, Minus } from "lucide-vue-next";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

type CheckedState = CheckboxRootProps["modelValue"];

const props = defineProps<
  CheckboxRootProps & {
    class?: HTMLAttributes["class"];
    checked?: CheckedState;
  }
>();

const emits = defineEmits<{
  (e: "update:checked", value: CheckedState): void;
}>();

// 支持 v-model:checked，同时转发底层 Reka Checkbox 的其它属性。
const checked = useVModel(props, "checked", emits, {
  passive: true,
  defaultValue: (props.modelValue ?? props.defaultValue ?? false) as CheckedState,
});

const delegatedProps = reactiveOmit(props, "class", "checked", "modelValue");
</script>

<template>
  <CheckboxRoot
    v-bind="delegatedProps"
    :model-value="checked"
    @update:model-value="(value) => (checked = value as CheckedState)"
    :class="
      cn(
        'peer h-4 w-4 shrink-0 rounded-full border border-border/60 bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-background data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:text-background',
        props.class,
      )
    "
  >
    <CheckboxIndicator class="flex items-center justify-center text-current">
      <Minus v-if="checked === 'indeterminate'" class="h-3 w-3" :stroke-width="2.5" />
      <Check v-else class="h-3 w-3" :stroke-width="2.5" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
