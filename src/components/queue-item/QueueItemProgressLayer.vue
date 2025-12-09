<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  showCardFillProgress: boolean;
  showRippleCardProgress: boolean;
  previewUrl: string | null;
  displayedClampedProgress: number;
  status: string;
}>();

const emit = defineEmits<{
  (e: "preview-error"): void;
}>();

// 根据任务状态计算波纹进度的颜色类
const rippleProgressColorClass = computed(() => {
  switch (props.status) {
    case "completed":
      return "bg-gradient-to-r from-emerald-500/30 via-emerald-500/60 to-emerald-500/30";
    case "failed":
      return "bg-gradient-to-r from-red-500/30 via-red-500/60 to-red-500/30";
    case "paused":
    case "waiting":
    case "queued":
      return "bg-gradient-to-r from-amber-500/30 via-amber-500/60 to-amber-500/30";
    case "cancelled":
    case "skipped":
      return "bg-gradient-to-r from-muted-foreground/30 via-muted-foreground/60 to-muted-foreground/30";
    case "processing":
    default:
      return "bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30";
  }
});

// 非处理中状态的静态颜色
const staticProgressColorClass = computed(() => {
  switch (props.status) {
    case "completed":
      return "bg-emerald-500/60";
    case "failed":
      return "bg-red-500/60";
    case "paused":
    case "waiting":
    case "queued":
      return "bg-amber-500/60";
    case "cancelled":
    case "skipped":
      return "bg-muted-foreground/60";
    case "processing":
    default:
      return "bg-primary/60";
  }
});
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
      :style="{ width: `${props.displayedClampedProgress}%` }"
    >
      <div
        v-if="props.status === 'processing'"
        class="h-full w-full opacity-80 animate-pulse"
        :class="rippleProgressColorClass"
      />
      <div v-else class="h-full w-full" :class="staticProgressColorClass" />
    </div>
  </div>
</template>
