<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  activeHours?: boolean[] | null;
  uptimeLabel: string;
  title?: string;
}>();

const normalizedHours = computed(() => {
  const hours = props.activeHours ?? [];
  if (hours.length === 24) return hours;
  return Array.from({ length: 24 }, (_, idx) => Boolean(hours[idx]));
});

const segments = computed(() => {
  const cx = 60;
  const cy = 60;
  const radius = 42;
  const per = 360 / 24;
  const gap = 3;
  const span = per - gap;

  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  return Array.from({ length: 24 }, (_, hour) => {
    const startDeg = -90 + hour * per + gap / 2;
    const endDeg = startDeg + span;
    const start = polar(startDeg);
    const end = polar(endDeg);
    const d = `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
    return { hour, d, active: normalizedHours.value[hour] ?? false };
  });
});
</script>

<template>
  <div class="heatmap-ring" :title="title">
    <svg class="heatmap-ring__svg" viewBox="0 0 120 120" role="img" aria-label="transcode-heatmap">
      <g>
        <path
          v-for="seg in segments"
          :key="seg.hour"
          class="heatmap-ring__segment"
          :class="{ active: seg.active }"
          :d="seg.d"
          data-testid="transcode-heatmap-segment"
          :data-hour="seg.hour"
        />
      </g>
      <text
        class="heatmap-ring__label"
        x="60"
        y="60"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ uptimeLabel }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.heatmap-ring {
  display: grid;
  place-items: center;
  padding: 0.25rem 0;
}

.heatmap-ring__svg {
  width: 112px;
  height: 112px;
  display: block;
}

.heatmap-ring__segment {
  fill: none;
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 10;
  stroke-linecap: round;
}

.heatmap-ring__segment.active {
  stroke: #00ff88;
  filter: drop-shadow(0 0 6px rgba(0, 255, 136, 0.35));
}

.heatmap-ring__label {
  font-size: 10px;
  font-weight: 700;
  fill: #ffaa00;
}
</style>

