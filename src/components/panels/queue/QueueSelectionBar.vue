<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { QueueMode } from "@/types";
import {
  CheckSquare,
  Square,
  X,
  Hourglass,
  Play,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  XCircle,
  Trash2,
  Pin,
  PinOff,
} from "lucide-vue-next";

const props = defineProps<{
  selectionBarPinned: boolean;
  selectedCount: number;
  queueMode: QueueMode;
}>();

const emit = defineEmits<{
  (e: "select-all-visible-jobs"): void;
  (e: "invert-selection"): void;
  (e: "clear-selection"): void;
  (e: "bulk-wait"): void;
  (e: "bulk-resume"): void;
  (e: "bulk-cancel"): void;
  (e: "bulk-restart"): void;
  (e: "bulk-move-to-top"): void;
  (e: "bulk-move-to-bottom"): void;
  (e: "bulk-delete"): void;
  (e: "toggle-selection-bar-pinned"): void;
}>();

const { t } = useI18n();
const emitTogglePin = () => emit("toggle-selection-bar-pinned");
</script>

<template>
  <div class="border-t border-border/60 px-3 py-1.5 bg-accent/5">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-foreground">
          {{ t("queue.selection.selectedCount", { count: props.selectedCount }) }}
        </span>

        <div class="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs"
            @click="emit('select-all-visible-jobs')"
          >
            <CheckSquare class="h-3 w-3" />
            <span class="hidden sm:inline">{{ t("queue.selection.selectAll") }}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs"
            @click="emit('invert-selection')"
          >
            <Square class="h-3 w-3" />
            <span class="hidden sm:inline">{{ t("queue.selection.invert") }}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs text-muted-foreground"
            @click="emit('clear-selection')"
          >
            <X class="h-3 w-3" />
            <span class="hidden sm:inline">{{ t("queue.selection.clear") }}</span>
          </Button>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          @click="emit('bulk-wait')"
          :title="t('queue.actions.bulkWait')"
        >
          <Hourglass class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkWait") }}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          @click="emit('bulk-resume')"
          :title="t('queue.actions.bulkResume')"
        >
          <Play class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkResume") }}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          @click="emit('bulk-cancel')"
          :title="t('queue.actions.bulkCancel')"
        >
          <XCircle class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkCancel") }}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          :disabled="props.queueMode !== 'queue'"
          @click="emit('bulk-restart')"
          :title="t('queue.actions.bulkRestart')"
        >
          <RefreshCw class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkRestart") }}</span>
        </Button>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          :disabled="props.queueMode !== 'queue'"
          @click="emit('bulk-move-to-top')"
          :title="t('queue.actions.bulkMoveToTop')"
        >
          <ArrowUp class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkMoveToTop") }}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          :disabled="props.queueMode !== 'queue'"
          @click="emit('bulk-move-to-bottom')"
          :title="t('queue.actions.bulkMoveToBottom')"
        >
          <ArrowDown class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkMoveToBottom") }}</span>
        </Button>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs text-destructive/80 hover:text-destructive"
          @click="emit('bulk-delete')"
          :title="t('queue.actions.bulkDelete')"
        >
          <Trash2 class="h-3 w-3" />
          <span class="hidden lg:inline">{{ t("queue.actions.bulkDelete") }}</span>
        </Button>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs"
          :class="{ 'text-primary': props.selectionBarPinned }"
          @click="emitTogglePin"
          :title="props.selectionBarPinned ? t('queue.selection.unpin') : t('queue.selection.pin')"
        >
          <PinOff v-if="props.selectionBarPinned" class="h-3 w-3" />
          <Pin v-else class="h-3 w-3" />
        </Button>
      </div>
    </div>
  </div>
</template>
