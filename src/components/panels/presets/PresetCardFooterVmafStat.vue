<script setup lang="ts">
import { useI18n } from "vue-i18n";

const props = defineProps<{
  show: boolean;
  title: string;
  vmaf95Plus: boolean;
  predictedVmafText: string;
  measuredVmafText: string | null;
  measuredVmafCount: number | null;
}>();

const { t } = useI18n();
</script>

<template>
  <span v-if="props.show" class="inline-flex items-center" :title="props.title" data-testid="preset-footer-vmaf-stat">
    <span :class="props.vmaf95Plus ? 'text-amber-400 font-semibold' : 'text-muted-foreground'">
      {{ t("presets.footerLabels.vmaf") }}
    </span>
    <span v-if="props.vmaf95Plus" class="text-amber-400 font-semibold ml-0.5">★</span>
    <span v-if="props.measuredVmafText" class="mx-0.5 text-emerald-400">{{ props.measuredVmafText }}</span>
    <span v-else class="mx-0.5 text-sky-400">{{ props.predictedVmafText }}</span>
  </span>
</template>
