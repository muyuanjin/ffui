<script setup lang="ts">
import type { ProgressRootProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { computed } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ProgressIndicator, ProgressRoot } from "reka-ui";
import { cn } from "@/lib/utils";

/**
 * 进度条状态变体，用于根据任务状态显示不同颜色
 * - default: 蓝色（处理中）
 * - success: 绿色（已完成）
 * - error: 红色（失败）
 * - warning: 黄色（暂停/等待）
 * - muted: 灰色（取消/跳过）
 */
export type ProgressVariant = "default" | "success" | "error" | "warning" | "muted";

const props = withDefaults(
  defineProps<
    ProgressRootProps & {
      class?: HTMLAttributes["class"];
      variant?: ProgressVariant;
    }
  >(),
  {
    modelValue: 0,
    variant: "default",
    class: undefined,
  },
);

const delegatedProps = reactiveOmit(props, "class", "variant");

// 根据 variant 返回对应的背景色和指示器颜色
const trackClass = computed(() => {
  switch (props.variant) {
    case "success":
      return "bg-emerald-500/20";
    case "error":
      return "bg-red-500/20";
    case "warning":
      return "bg-amber-500/20";
    case "muted":
      return "bg-muted-foreground/20";
    default:
      return "bg-primary/20";
  }
});

const indicatorClass = computed(() => {
  switch (props.variant) {
    case "success":
      return "bg-emerald-500";
    case "error":
      return "bg-red-500";
    case "warning":
      return "bg-amber-500";
    case "muted":
      return "bg-muted-foreground";
    default:
      return "bg-primary";
  }
});
</script>

<template>
  <ProgressRoot
    v-bind="delegatedProps"
    :class="cn('relative h-2 w-full overflow-hidden rounded-full', trackClass, props.class)"
  >
    <ProgressIndicator
      :class="cn('h-full w-full flex-1 transition-transform duration-150 ease-linear', indicatorClass)"
      :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
  </ProgressRoot>
</template>
