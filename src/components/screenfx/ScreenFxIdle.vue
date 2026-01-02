<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { startHoldBootFx, type BootFxIds } from "@/boot/bootFx";

const ids: BootFxIds = {
  rootId: "ffui-screenfx-boot",
  canvasId: "ffui-screenfx-boot-stream",
  textStreamId: "ffui-screenfx-text-stream",
};

let cleanup: (() => void) | null = null;

onMounted(() => {
  cleanup = startHoldBootFx(ids) ?? null;
});

onUnmounted(() => {
  cleanup?.();
  cleanup = null;
});
</script>

<template>
  <div id="ffui-screenfx-boot" class="ffui-boot" aria-label="screen-fx-idle">
    <canvas id="ffui-screenfx-boot-stream" class="ffui-boot-stream"></canvas>
    <div class="ffui-boot-vignette"></div>
    <div id="ffui-screenfx-text-stream" class="ffui-boot-text-stream" aria-hidden="true"></div>
  </div>
</template>
