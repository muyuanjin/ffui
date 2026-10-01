<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>

<template>
  <div
    role="progressbar"
    :aria-label="t('queue.command.indeterminate')"
    class="relative z-10 h-1.5 overflow-hidden rounded-full bg-primary/20"
    data-testid="queue-item-progress-indeterminate"
  >
    <div class="queue-activity h-full w-1/3 bg-primary" />
  </div>
</template>

<style scoped>
.queue-activity {
  animation: queue-activity-travel 1.4s ease-in-out infinite;
}

@keyframes queue-activity-travel {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .queue-activity {
    animation: none;
    width: 100%;
    opacity: 0.4;
  }
}
</style>
