<script setup lang="ts">
import { computed } from "vue";
import type { FFmpegPreset, TranscodeJob } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  job: TranscodeJob;
  preset: FFmpegPreset;
  canCancel?: boolean;
}>();

const emit = defineEmits<{
  (e: "cancel", id: string): void;
  (e: "inspect", job: TranscodeJob): void;
}>();

const isSkipped = computed(() => props.job.status === "skipped");

const statusTextClass = computed(() => {
  switch (props.job.status) {
    case "completed":
      return "text-emerald-500";
    case "processing":
      return "text-blue-500";
    case "cancelled":
      return "text-muted-foreground";
    case "skipped":
      return "text-muted-foreground";
    case "waiting":
      return "text-amber-500";
    case "failed":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
});

const { t } = useI18n();

const localizedStatus = computed(() => t(`queue.status.${props.job.status}`));

const typeLabel = computed(() =>
  props.job.type === "image" ? t("queue.typeImage") : t("queue.typeVideo"),
);

const sourceLabel = computed(() => {
  if (props.job.source === "smart_scan") {
    return t("queue.source.smartScan");
  }
  return t("queue.source.manual");
});

const isCancellable = computed(
  () =>
    props.canCancel &&
    (props.job.status === "waiting" ||
      props.job.status === "queued" ||
      props.job.status === "processing"),
);

const displayFilename = computed(() => {
  const name = props.job.filename;
  if (!name) return "";
  const slash = name.lastIndexOf("/");
  const backslash = name.lastIndexOf("\\");
  const idx = Math.max(slash, backslash);
  return idx >= 0 ? name.slice(idx + 1) : name;
});

const displayOriginalSize = computed(() => {
  const value = props.job.originalSizeMB;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0.00";
  }
  return value.toFixed(2);
});

const displayOutputSize = computed(() => {
  const value = props.job.outputSizeMB;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0.00";
  }
  return value.toFixed(2);
});

const savedLabel = computed(() => {
  const output = props.job.outputSizeMB;
  const input = props.job.originalSizeMB;
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return "";
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return "";
  const percent = ((1 - output / input) * 100).toFixed(0);
  return t("queue.savedShort", { percent });
});

const combinedLogs = computed(() => {
  const logs = props.job.logs;
  if (!logs || logs.length === 0) return "";
  return logs.join("\n");
});

const mediaSummary = computed(() => {
  const info = props.job.mediaInfo;
  if (!info) return "";

  const parts: string[] = [];

  const duration = info.durationSeconds;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const totalSeconds = Math.floor(duration);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    parts.push(`${minutes}:${seconds.toString().padStart(2, "0")}`);
  }

  if (typeof info.width === "number" && typeof info.height === "number") {
    parts.push(`${info.width}×${info.height}`);
  }

  const size = info.sizeMB;
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    parts.push(`${size.toFixed(2)} MB`);
  }

  if (info.videoCodec) {
    parts.push(info.videoCodec.toUpperCase());
  }

  return parts.join(" • ");
});
</script>

<template>
  <Card
    class="mb-3 border-border/60 bg-card/80 transition-colors p-3 md:p-4 cursor-pointer"
    :class="isSkipped ? 'opacity-60 bg-muted/60' : 'hover:border-primary/40'"
    @click="emit('inspect', job)"
  >
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold"
          :class="{
            'border-emerald-500/60 text-emerald-400 bg-emerald-500/10': job.status === 'completed',
            'border-blue-500/60 text-blue-400 bg-blue-500/10': job.status === 'processing',
            'border-amber-500/60 text-amber-400 bg-amber-500/10': job.status === 'waiting',
            'border-red-500/60 text-red-400 bg-red-500/10': job.status === 'failed',
            'border-muted-foreground/40 text-muted-foreground bg-muted/40': job.status === 'skipped',
          }"
        >
          <span v-if="job.status === 'completed'">✓</span>
          <span v-else-if="job.status === 'failed'">!</span>
          <span v-else-if="job.status === 'processing'">●</span>
          <span v-else-if="job.status === 'waiting'">…</span>
          <span v-else-if="job.status === 'skipped'">×</span>
          <span v-else>•</span>
        </span>

        <div>
          <div class="flex items-center gap-2">
            <Badge
              variant="outline"
              class="px-1.5 py-0.5 text-[10px] font-medium"
              :class="job.type === 'image' ? 'border-purple-500/40 text-purple-300' : 'border-blue-500/40 text-blue-300'"
            >
              {{ typeLabel }}
            </Badge>
            <h4
              class="font-medium truncate max-w-xs md:max-w-md"
              :class="isSkipped ? 'text-muted-foreground' : 'text-foreground'"
              :title="job.filename"
            >
              {{ displayFilename }}
            </h4>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
            <span
              v-if="!isSkipped"
              class="bg-muted px-1.5 py-0.5 rounded text-foreground"
            >
              {{ preset.name }}
            </span>
            <span>{{ displayOriginalSize }} MB</span>
            <span
              v-if="job.originalCodec"
              class="uppercase text-muted-foreground border border-border px-1 rounded"
            >
              {{ job.originalCodec }}
            </span>

            <template v-if="job.status === 'completed' && job.outputSizeMB">
              <span>→</span>
              <span class="text-emerald-400 font-bold">
                {{ displayOutputSize }} MB
              </span>
              <span>({{ savedLabel }})</span>
            </template>

            <span
              v-if="isSkipped && job.skipReason"
              class="text-amber-400 italic ml-2"
            >
              {{ t("queue.skippedPrefix") }} {{ job.skipReason }}
            </span>
            <span
              v-if="job.source"
              class="inline-flex items-center px-1.5 py-0.5 rounded border border-border/60 text-[10px] uppercase tracking-wide"
            >
              {{ sourceLabel }}
            </span>
          </div>
        </div>
      </div>

      <div class="text-right flex flex-col items-end gap-1">
        <span class="text-xs font-bold uppercase tracking-wide" :class="statusTextClass">
          {{ localizedStatus }}
        </span>
        <Button
          v-if="isCancellable"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          @click.stop="emit('cancel', job.id)"
        >
          {{ t("app.actions.cancel") }}
        </Button>
      </div>
    </div>

    <Progress
      v-if="!isSkipped && job.status !== 'waiting'"
      :model-value="job.progress"
      class="mt-2"
    />
    <div
      v-if="mediaSummary"
      class="mt-2 text-[11px] text-muted-foreground flex flex-wrap gap-2"
    >
      <span class="inline-flex items-center rounded bg-muted px-1.5 py-0.5">
        {{ mediaSummary }}
      </span>
    </div>
    <div v-if="combinedLogs" class="mt-2">
      <pre
        class="max-h-40 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap select-text"
      >{{ combinedLogs }}</pre>
    </div>
  </Card>
</template>
