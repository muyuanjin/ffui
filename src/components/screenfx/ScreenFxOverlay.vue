<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import type { TranscodeJob } from "@/types";
import ScreenFxIdle from "./ScreenFxIdle.vue";
import ScreenFxLive from "./ScreenFxLive.vue";

const props = defineProps<{
  open: boolean;
  jobs: TranscodeJob[];
  toggleOpen: () => void;
  toggleFullscreen: () => Promise<void>;
}>();

const processingJobs = computed(() => props.jobs.filter((job) => job.status === "processing"));
const hasProcessing = computed(() => processingJobs.value.length > 0);

const handleKeydown = async (event: KeyboardEvent) => {
  if (!props.open) return;
  if (event.key !== "F11") return;
  event.preventDefault();
  await props.toggleFullscreen();
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="ffui-screenfx-overlay"
      aria-label="screen-fx-overlay"
      role="button"
      tabindex="0"
      @click="props.toggleOpen"
    >
      <ScreenFxLive v-if="hasProcessing" :jobs="processingJobs" />
      <ScreenFxIdle v-else />
    </div>
  </Teleport>
</template>

<style scoped>
.ffui-screenfx-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: pointer;
}
</style>
