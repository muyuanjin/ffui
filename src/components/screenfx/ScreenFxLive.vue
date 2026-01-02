<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { TranscodeJob } from "@/types";
import { startLiveRenderFlow } from "./liveRenderFlow";

const props = defineProps<{
  jobs: TranscodeJob[];
}>();

const textWorld = ref<HTMLElement | null>(null);
const imageWorld = ref<HTMLElement | null>(null);
let cleanup: (() => void) | null = null;
let jobsSnapshot: TranscodeJob[] = props.jobs;

watch(
  () => props.jobs,
  (next) => {
    jobsSnapshot = next;
  },
  { deep: true },
);

onMounted(() => {
  const text = textWorld.value;
  const image = imageWorld.value;
  if (!text || !image) return;
  cleanup = startLiveRenderFlow({
    textWorld: text,
    imageWorld: image,
    getJobs: () => jobsSnapshot,
  });
});

onUnmounted(() => {
  cleanup?.();
  cleanup = null;
});
</script>

<template>
  <div class="ffui-screenfx-live" aria-label="screen-fx-live">
    <div ref="textWorld" class="ffui-screenfx-world ffui-screenfx-world--text"></div>
    <div ref="imageWorld" class="ffui-screenfx-world ffui-screenfx-world--image"></div>
    <div class="ffui-screenfx-scanline"></div>
    <div class="ffui-screenfx-live__hint">Live Render Stream // Processing (F11)</div>
  </div>
</template>

<style scoped>
.ffui-screenfx-live {
  position: fixed;
  inset: 0;
  background: #000;
  color: rgba(224, 224, 224, 0.9);
  overflow: hidden;
}

.ffui-screenfx-world {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.ffui-screenfx-world--text {
  z-index: 10;
}

.ffui-screenfx-world--image {
  z-index: 20;
}

.ffui-screenfx-scanline {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(0, 255, 170, 0.1),
    rgba(0, 255, 170, 0.85),
    rgba(0, 255, 170, 0.1),
    transparent
  );
  z-index: 30;
  box-shadow: 0 0 30px rgba(0, 255, 170, 0.32);
  opacity: 0.75;
  pointer-events: none;
}

.ffui-screenfx-live__hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.25);
  user-select: none;
  z-index: 40;
}

.ffui-screenfx-live :deep(.ffui-screenfx-row) {
  position: absolute;
  display: flex;
  align-items: center;
  white-space: nowrap;
  will-change: transform;
  height: 80px;
}

.ffui-screenfx-live :deep(.ffui-screenfx-code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 14px;
  opacity: 0.9;
  color: rgba(255, 255, 255, 0.75);
  filter: brightness(0.9);
}

.ffui-screenfx-live :deep(.ffui-screenfx-image) {
  position: relative;
  height: 70px;
  width: 125px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: -100px;
}

.ffui-screenfx-live :deep(.ffui-screenfx-image img) {
  height: 100%;
  width: 100%;
  object-fit: cover;
  border-radius: 4px;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
  filter: brightness(1.05) contrast(1.1);
  display: block;
}
</style>
