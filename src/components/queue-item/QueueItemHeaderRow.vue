<script setup lang="ts">
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FFmpegPreset, TranscodeJob } from "@/types";

const {
  job,
  preset,
  isSelectable,
  isSelected,
  isSkipped,
  typeLabel,
  displayFilename,
  displayOriginalSize,
  displayOutputSize,
  savedLabel,
  sourceLabel,
  statusTextClass,
  localizedStatus,
  isWaitable,
  isResumable,
  isRestartable,
  isCancellable,
  previewUrl,
  t,
} = defineProps<{
  job: TranscodeJob;
  preset: FFmpegPreset;
  isSelectable: boolean;
  isSelected: boolean;
  isSkipped: boolean;
  typeLabel: string | unknown;
  displayFilename: string;
  displayOriginalSize: string;
  displayOutputSize: string;
  savedLabel: string;
  sourceLabel: string | unknown;
  statusTextClass: string;
  localizedStatus: string | unknown;
  isWaitable: boolean;
  isResumable: boolean;
  isRestartable: boolean;
  isCancellable: boolean;
  previewUrl: string | null;
  t: (key: string, params?: any) => string | unknown;
}>();

const emit = defineEmits<{
  (e: "toggle-select", id: string): void;
  (e: "wait", id: string): void;
  (e: "resume", id: string): void;
  (e: "restart", id: string): void;
  (e: "cancel", id: string): void;
  (e: "preview", job: TranscodeJob): void;
  (e: "preview-error"): void;
   (e: "inspect", job: TranscodeJob): void;
}>();
</script>

<template>
  <div class="relative flex items-center justify-between mb-2">
    <div class="flex items-center gap-3">
      <!-- 左侧选择指示条 -->
      <button
        v-if="isSelectable"
        type="button"
        class="w-1 h-14 rounded-full transition-all flex-shrink-0"
        :class="isSelected
          ? 'bg-amber-500'
          : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        data-testid="queue-item-select-toggle"
        @click.stop="emit('toggle-select', job.id)"
      />
      <div
        class="relative h-[72px] w-32 rounded-md bg-muted overflow-hidden border border-border/60 flex items-center justify-center flex-shrink-0 cursor-pointer"
        data-testid="queue-item-thumbnail"
        @click.stop="emit('preview', job)"
      >
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          class="h-full w-full object-cover"
          @error="emit('preview-error')"
        />
      </div>
      <span
        class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold"
        :class="{
          'border-emerald-500/60 text-emerald-400 bg-emerald-500/10': job.status === 'completed',
          'border-blue-500/60 text-blue-400 bg-blue-500/10': job.status === 'processing',
          'border-amber-500/60 text-amber-400 bg-amber-500/10':
            job.status === 'waiting' || job.status === 'paused',
          'border-red-500/60 text-red-400 bg-red-500/10': job.status === 'failed',
          'border-muted-foreground/40 text-muted-foreground bg-muted/40': job.status === 'skipped',
        }"
      >
        <span v-if="job.status === 'completed'">✓</span>
        <span v-else-if="job.status === 'failed'">!</span>
        <span v-else-if="job.status === 'processing'">●</span>
        <span v-else-if="job.status === 'waiting'">…</span>
        <span v-else-if="job.status === 'paused'">Ⅱ</span>
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
          <span v-if="!isSkipped" class="bg-muted px-1.5 py-0.5 rounded text-foreground">
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

          <span v-if="isSkipped && job.skipReason" class="text-amber-400 italic ml-2">
            {{ t('queue.skippedPrefix') }} {{ job.skipReason }}
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

    <div class="text-right flex flex-col items-end gap-1.5">
      <span class="text-xs font-bold uppercase tracking-wide" :class="statusTextClass">
        {{ localizedStatus }}
      </span>
      <div class="flex flex-wrap justify-end items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-3 text-[11px] border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
          data-testid="queue-item-detail-button"
          @click.stop="emit('inspect', job)"
        >
          {{ t("jobDetail.title") }}
        </Button>
        <Button
          v-if="isWaitable"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          data-testid="queue-item-wait-button"
          @click.stop="emit('wait', job.id)"
        >
          {{ t('queue.actions.wait') }}
        </Button>
        <Button
          v-if="isResumable"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          data-testid="queue-item-resume-button"
          @click.stop="emit('resume', job.id)"
        >
          {{ t('queue.actions.resume') }}
        </Button>
        <Button
          v-if="isRestartable"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          data-testid="queue-item-restart-button"
          @click.stop="emit('restart', job.id)"
        >
          {{ t('queue.actions.restart') }}
        </Button>
        <Button
          v-if="isCancellable"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          @click.stop="emit('cancel', job.id)"
        >
          {{ t('app.actions.cancel') }}
        </Button>
      </div>
    </div>
  </div>
</template>
