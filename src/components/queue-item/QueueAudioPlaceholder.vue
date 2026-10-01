<script setup lang="ts">
import { Music } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
const { t } = useI18n();
</script>

<template>
  <Music
    role="img"
    :aria-label="t('queue.media.noAudioCover')"
    class="h-1/2 w-1/2 max-h-16 max-w-16 text-muted-foreground/50"
    data-testid="queue-audio-placeholder"
  />
</template>
