<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>

<template>
  <div
    role="progressbar"
    :aria-label="t('queue.command.indeterminate')"
    class="relative z-10 h-1.5 overflow-hidden bg-primary/20"
    data-testid="queue-item-progress-indeterminate"
  >
    <div class="h-full w-1/3 animate-pulse bg-primary" />
  </div>
</template>
