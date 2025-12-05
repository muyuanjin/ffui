<script setup lang="ts">
const {
  showCardFillProgress,
  showRippleCardProgress,
  previewUrl,
  displayedClampedProgress,
  status,
} = defineProps<{
  showCardFillProgress: boolean;
  showRippleCardProgress: boolean;
  previewUrl: string | null;
  displayedClampedProgress: number;
  status: string;
}>();

const emit = defineEmits<{
  (e: "preview-error"): void;
}>();
</script>

<template>
  <div
    v-if="showCardFillProgress"
    class="absolute inset-0 pointer-events-none"
    data-testid="queue-item-progress-card-fill"
  >
    <div class="absolute inset-0 bg-card/40" />
    <div
      class="absolute inset-y-0 left-0 overflow-hidden"
      data-testid="queue-item-progress-fill"
      :style="{ width: `${displayedClampedProgress}%` }"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt=""
        class="h-full w-full object-cover opacity-95"
        @error="emit('preview-error')"
      />
      <div v-else class="h-full w-full bg-gradient-to-r from-card/40 via-card/20 to-card/0" />
    </div>
  </div>
  <div
    v-else-if="showRippleCardProgress"
    class="absolute inset-0 pointer-events-none"
    data-testid="queue-item-progress-ripple-card"
  >
    <div
      class="absolute inset-y-0 left-0"
      data-testid="queue-item-progress-fill"
      :style="{ width: `${displayedClampedProgress}%` }"
    >
      <div
        v-if="status === 'processing'"
        class="h-full w-full bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30 opacity-80 animate-pulse"
      />
      <div v-else class="h-full w-full bg-primary/60" />
    </div>
  </div>
</template>
