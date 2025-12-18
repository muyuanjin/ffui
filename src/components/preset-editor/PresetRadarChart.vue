<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PresetRadar } from "@/lib/presetInsights";

const props = defineProps<{
  metrics: PresetRadar;
  hasStats: boolean;
}>();

const { t } = useI18n();

const axisKeys = ["quality", "sizeSaving", "speed", "compatibility", "popularity"] as const;

const maxValue = 5;
const centerX = 64;
const centerY = 64;
const maxRadius = 40;

const polygonPoints = computed(() => {
  const values = axisKeys.map((key, index) => {
    const raw = props.metrics[key] ?? 0;
    const value = Math.max(0, Math.min(maxValue, raw));
    const angle = (Math.PI * 2 * index) / axisKeys.length - Math.PI / 2;
    const r = (value / maxValue) * maxRadius;
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
    return `${x},${y}`;
  });
  return values.join(" ");
});

const axes = computed(() =>
  axisKeys.map((key, index) => {
    const angle = (Math.PI * 2 * index) / axisKeys.length - Math.PI / 2;
    const x = centerX + maxRadius * Math.cos(angle);
    const y = centerY + maxRadius * Math.sin(angle);
    return { key, x, y };
  }),
);
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold text-foreground">
        {{ t("presetEditor.panel.insightsTitle") }}
      </h3>
      <span class="text-[10px] text-muted-foreground">
        {{ hasStats ? t("presetEditor.panel.insightsWithStats") : t("presetEditor.panel.insightsNoStats") }}
      </span>
    </div>

    <svg width="128" height="128" viewBox="0 0 128 128" class="mx-auto block" aria-hidden="true">
      <!-- 背景网格圆 -->
      <circle
        v-for="level in [0.25, 0.5, 0.75, 1]"
        :key="level"
        :cx="centerX"
        :cy="centerY"
        :r="maxRadius * level"
        class="fill-none stroke-border/60"
        stroke-width="0.5"
      />

      <!-- 轴线 -->
      <line
        v-for="axis in axes"
        :key="axis.key"
        :x1="centerX"
        :y1="centerY"
        :x2="axis.x"
        :y2="axis.y"
        class="stroke-border/80"
        stroke-width="0.5"
      />

      <!-- 雷达多边形 -->
      <polygon :points="polygonPoints" class="fill-primary/30 stroke-primary" stroke-width="1" />

      <!-- 轴标签 -->
      <text
        v-for="axis in axes"
        :key="axis.key"
        :x="axis.x"
        :y="axis.y"
        class="text-[9px] fill-foreground"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        <tspan v-if="axis.key === 'quality'">
          {{ t("presetEditor.panel.radarQuality") }}
        </tspan>
        <tspan v-else-if="axis.key === 'sizeSaving'">
          {{ t("presetEditor.panel.radarSize") }}
        </tspan>
        <tspan v-else-if="axis.key === 'speed'">
          {{ t("presetEditor.panel.radarSpeed") }}
        </tspan>
        <tspan v-else-if="axis.key === 'compatibility'">
          {{ t("presetEditor.panel.radarCompatibility") }}
        </tspan>
        <tspan v-else>
          {{ t("presetEditor.panel.radarPopularity") }}
        </tspan>
      </text>
    </svg>

    <div class="flex justify-between text-[10px] text-muted-foreground">
      <span>{{ t("presetEditor.panel.radarLow") }}</span>
      <span>{{ t("presetEditor.panel.radarHigh") }}</span>
    </div>
  </div>
</template>
