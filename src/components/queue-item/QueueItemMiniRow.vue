<script setup lang="ts">
import { computed, toRefs } from "vue";
import { Button } from "@/components/ui/button";
import { Progress, type ProgressVariant } from "@/components/ui/progress";
import type { FFmpegPreset, TranscodeJob, Translate } from "@/types";
import { Eye, Hourglass, Play, RefreshCw, XCircle } from "lucide-vue-next";
import type { QueueItemRowEmits } from "@/components/queue-item/queueItemRowEmits";

const props = defineProps<{
  job: TranscodeJob;
  preset: FFmpegPreset;
  isSelectable: boolean;
  isSelected: boolean;
  isSkipped: boolean;
  typeLabel: string | unknown;
  displayFilename: string;
  displayOriginalSize: string;
  statusTextClass: string;
  localizedStatus: string | unknown;
  isWaitable: boolean;
  isResumable: boolean;
  isRestartable: boolean;
  isCancellable: boolean;
  previewUrl: string | null;
  progressValue: number;
  progressVariant: ProgressVariant;
  t: Translate;
}>();

const emit = defineEmits<QueueItemRowEmits>();

const {
  job,
  preset,
  isSelectable,
  isSelected,
  isSkipped,
  displayFilename,
  displayOriginalSize,
  statusTextClass,
  localizedStatus,
  isWaitable,
  isResumable,
  isRestartable,
  isCancellable,
  previewUrl,
  progressValue,
  progressVariant,
  t,
} = toRefs(props);

const primaryAction = computed<
  | { kind: "wait"; title: string; onClick: () => void; icon: typeof Hourglass }
  | { kind: "resume"; title: string; onClick: () => void; icon: typeof Play }
  | { kind: "restart"; title: string; onClick: () => void; icon: typeof RefreshCw }
  | { kind: "cancel"; title: string; onClick: () => void; icon: typeof XCircle }
  | null
>(() => {
  if (isWaitable.value) {
    return {
      kind: "wait",
      title: String(t.value("queue.actions.wait")),
      onClick: () => emit("wait", job.value.id),
      icon: Hourglass,
    };
  }
  if (isResumable.value) {
    return {
      kind: "resume",
      title: String(t.value("queue.actions.resume")),
      onClick: () => emit("resume", job.value.id),
      icon: Play,
    };
  }
  if (isRestartable.value) {
    return {
      kind: "restart",
      title: String(t.value("queue.actions.restart")),
      onClick: () => emit("restart", job.value.id),
      icon: RefreshCw,
    };
  }
  if (isCancellable.value) {
    return {
      kind: "cancel",
      title: String(t.value("app.actions.cancel")),
      onClick: () => emit("cancel", job.value.id),
      icon: XCircle,
    };
  }
  return null;
});
</script>

<template>
  <div class="flex items-stretch gap-2 h-11">
    <div class="flex items-center gap-2 flex-shrink-0">
      <Button
        v-if="isSelectable"
        type="button"
        variant="ghost"
        size="icon-xs"
        class="w-1 h-9 p-0 rounded-full transition-colors flex-shrink-0"
        :class="isSelected ? 'bg-amber-500' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        data-testid="queue-item-select-toggle"
        @click.stop="emit('toggle-select', job.id)"
      />

      <div
        class="relative h-8 w-11 rounded bg-muted overflow-hidden border border-border/60 flex items-center justify-center flex-shrink-0 cursor-pointer"
        data-testid="queue-item-thumbnail"
        @click.stop="emit('preview', job)"
      >
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          decoding="async"
          loading="lazy"
          fetchpriority="low"
          class="h-full w-full object-cover"
          @error="emit('preview-error')"
        />
      </div>
    </div>

    <div class="min-w-0 flex-1 flex flex-col justify-center gap-1">
      <div class="min-w-0 flex items-center gap-1.5">
        <h4
          class="min-w-0 flex-1 truncate text-[11px] leading-4 font-medium"
          :class="isSkipped ? 'text-muted-foreground' : 'text-foreground'"
          :title="job.filename"
        >
          {{ displayFilename }}
        </h4>

        <span
          v-if="!isSkipped"
          class="flex-shrink-0 text-[10px] leading-4 text-muted-foreground truncate max-w-[120px]"
        >
          {{ preset.name }}
        </span>

        <span class="flex-shrink-0 text-[10px] leading-4 text-muted-foreground tabular-nums">
          {{ displayOriginalSize }}MB
        </span>

        <span class="flex-shrink-0 text-[10px] leading-4 font-semibold" :class="statusTextClass">
          {{ localizedStatus }}
        </span>

        <div class="ml-1 flex items-center gap-1 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            class="h-6 w-6 p-0 border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
            data-testid="queue-item-detail-button"
            :title="String(t('jobDetail.title'))"
            @click.stop="emit('inspect', job)"
          >
            <Eye class="h-4 w-4" aria-hidden="true" />
          </Button>

          <Button
            v-if="primaryAction"
            type="button"
            variant="outline"
            size="icon-xs"
            class="h-6 w-6 p-0 border-border/60"
            :data-testid="`queue-item-mini-action-${primaryAction.kind}`"
            :title="primaryAction.title"
            @click.stop="primaryAction.onClick"
          >
            <component :is="primaryAction.icon" class="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Progress
        class="h-1.5"
        :model-value="progressValue"
        :variant="progressVariant"
        data-testid="queue-item-progress-bar"
      />
    </div>
  </div>
</template>
