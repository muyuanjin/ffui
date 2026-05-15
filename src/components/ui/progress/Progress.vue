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

export interface ProgressSegment {
  value: number;
  variant?: ProgressVariant;
  class?: HTMLAttributes["class"];
  layerClass?: HTMLAttributes["class"];
}

const props = withDefaults(
  defineProps<
    ProgressRootProps & {
      class?: HTMLAttributes["class"];
      variant?: ProgressVariant;
      transitionMs?: number;
      segments?: ProgressSegment[];
    }
  >(),
  {
    modelValue: 0,
    variant: "default",
    class: undefined,
    transitionMs: 150,
    segments: undefined,
  },
);

const delegatedProps = reactiveOmit(props, "class", "variant", "transitionMs", "segments");

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
  return indicatorClassForVariant(props.variant);
});

const indicatorClassForVariant = (variant: ProgressVariant | undefined) => {
  switch (variant) {
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
};

const clampedSegmentValue = (value: number) => {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
};

const visibleSegments = computed(() => {
  const segments = props.segments ?? [];
  return segments;
});

const segmentStyle = (value: number) => ({
  transform: `translateX(-${100 - clampedSegmentValue(value)}%)`,
  transitionDuration: `${Math.max(0, Math.floor(props.transitionMs ?? 0))}ms`,
});
</script>

<template>
  <ProgressRoot
    v-bind="delegatedProps"
    :class="cn('relative h-2 w-full overflow-hidden rounded-full', trackClass, props.class)"
  >
    <template v-if="visibleSegments.length > 0">
      <ProgressIndicator
        v-for="(segment, index) in visibleSegments"
        :key="index"
        :class="
          cn(
            'absolute inset-y-0 left-0 h-full w-full transition-transform ease-linear',
            indicatorClassForVariant(segment.variant ?? props.variant),
            segment.layerClass,
            segment.class,
          )
        "
        :style="segmentStyle(segment.value)"
        :data-testid="`progress-segment-${index}`"
      />
    </template>
    <ProgressIndicator
      v-else
      :class="cn('h-full w-full flex-1 transition-transform ease-linear', indicatorClass)"
      :style="segmentStyle(props.modelValue ?? 0)"
    />
  </ProgressRoot>
</template>
