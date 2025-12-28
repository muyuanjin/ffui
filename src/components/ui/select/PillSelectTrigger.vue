<script setup lang="ts">
import type { SelectTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { cn } from "@/lib/utils";
import SelectTrigger from "./SelectTrigger.vue";

const props = defineProps<
  SelectTriggerProps & {
    class?: HTMLAttributes["class"];
    /** 悬浮提示文字，用于显示被截断的完整内容 */
    title?: string;
  }
>();

const delegatedProps = reactiveOmit(props, "class");

const PILL_SELECT_TRIGGER_CLASS =
  "h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[104px]";
</script>

<template>
  <SelectTrigger
    v-bind="delegatedProps"
    data-ffui-select-trigger="pill"
    :class="cn(PILL_SELECT_TRIGGER_CLASS, props.class)"
  >
    <slot />
  </SelectTrigger>
</template>
