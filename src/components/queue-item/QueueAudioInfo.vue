<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";

const props = defineProps<{ job: TranscodeJob; compact?: boolean }>();
const { t } = useI18n();
const summary = computed(() => {
  const info = props.job.mediaInfo;
  if (!info) return "";
  const parts: string[] = [];
  if (!props.compact) {
    parts.push(
      ...[info.audio?.title, info.audio?.artist, info.audio?.album].filter((value): value is string => !!value),
    );
  }
  if (info.audioCodec) parts.push(info.audioCodec.toUpperCase());
  if (typeof info.durationSeconds === "number" && Number.isFinite(info.durationSeconds) && info.durationSeconds > 0) {
    const seconds = Math.floor(info.durationSeconds);
    parts.push(
      t("queue.media.duration", { time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` }),
    );
  }
  const audio = info.audio;
  if (audio?.sampleRateHz) parts.push(`${audio.sampleRateHz / 1000} kHz`);
  if (audio?.channels) parts.push(t("queue.media.channels", { count: audio.channels }));
  if (audio?.bitRateKbps) parts.push(`${Math.round(audio.bitRateKbps)} kb/s`);
  return parts.join(" · ");
});
</script>

<template>
  <p
    v-if="job.type === 'audio' && summary"
    class="min-w-0 truncate text-xs text-muted-foreground"
    :title="summary"
    data-testid="queue-audio-info"
  >
    {{ summary }}
  </p>
</template>
