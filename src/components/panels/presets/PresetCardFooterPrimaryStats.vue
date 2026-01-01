<script setup lang="ts">
import type { StyleValue } from "vue";
import PresetCardFooterVmafStat from "./PresetCardFooterVmafStat.vue";

const props = defineProps<{
  showAvgSize: boolean;
  showFps: boolean;
  showVmaf: boolean;

  avgSizeLabel: string;
  fpsLabel: string;

  avgRatioText: string;
  avgRatioTitle: string;
  ratioColorClass: string | null;

  avgFpsText: string;
  avgFpsTitle: string;

  orderAvgSize: StyleValue;
  orderFps: StyleValue;
  orderVmaf: StyleValue;

  vmafStatProps: {
    show: boolean;
    title: string;
    vmaf95Plus: boolean;
    predictedVmafText: string;
    measuredVmafText: string | null;
    measuredVmafCount: number | null;
  };
}>();
</script>

<template>
  <span
    v-if="props.showAvgSize"
    class="flex flex-wrap items-center max-w-full"
    :style="props.orderAvgSize"
    :title="props.avgRatioTitle"
    data-footer-item="avgSize"
  >
    <span v-if="props.avgSizeLabel" class="text-muted-foreground">{{ props.avgSizeLabel }}</span>
    <span>
      <span class="mx-0.5" :class="props.ratioColorClass">{{ props.avgRatioText }}</span>
      <span class="text-muted-foreground">%</span>
    </span>
  </span>

  <span
    v-if="props.showFps"
    class="flex flex-wrap items-center max-w-full"
    :style="props.orderFps"
    :title="props.avgFpsTitle"
    data-footer-item="fps"
  >
    <span class="text-muted-foreground">{{ props.fpsLabel }}</span>
    <span class="text-foreground mx-0.5">{{ props.avgFpsText }}</span>
  </span>

  <span
    v-if="props.showVmaf"
    class="flex flex-wrap items-center max-w-full"
    :style="props.orderVmaf"
    data-footer-item="vmaf"
  >
    <PresetCardFooterVmafStat v-bind="props.vmafStatProps" />
  </span>
</template>
