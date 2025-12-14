<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Hourglass,
  MoreHorizontal,
  Pin,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
  XCircle,
} from "lucide-vue-next";

const props = defineProps<{
  selectedCount: number;
  setFullSizerRowEl: (el: HTMLDivElement | null) => void;
  setShortSizerRowEl: (el: HTMLDivElement | null) => void;
}>();

const { t } = useI18n();
</script>

<template>
  <!-- Hidden sizers: measure full/short widths to decide the best density without showing scrollbars. -->
  <div class="queue-selection-bar__sizer" aria-hidden="true">
    <div
      :ref="(el) => props.setFullSizerRowEl(el as HTMLDivElement | null)"
      class="queue-selection-bar__sizer-row queue-selection-bar__sizer-row--full flex items-center justify-between gap-2 min-w-max font-medium"
    >
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-medium text-foreground whitespace-nowrap">
          {{ t("queue.selection.selectedCount", { count: props.selectedCount }) }}
        </span>

        <div class="flex items-center gap-1">
          <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
            <CheckSquare class="h-3 w-3" />
            <span class="whitespace-nowrap">{{ t("queue.selection.selectAll") }}</span>
          </div>

          <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
            <Square class="h-3 w-3" />
            <span class="whitespace-nowrap">{{ t("queue.selection.invert") }}</span>
          </div>

          <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center text-muted-foreground">
            <X class="h-3 w-3" />
            <span class="whitespace-nowrap">{{ t("queue.selection.clear") }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <Hourglass class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkWait") }}</span>
        </div>

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <Play class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkResume") }}</span>
        </div>

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <XCircle class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkCancel") }}</span>
        </div>

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <RefreshCw class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkRestart") }}</span>
        </div>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <ArrowUp class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkMoveToTop") }}</span>
        </div>

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <ArrowDown class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkMoveToBottom") }}</span>
        </div>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center text-destructive/80">
          <Trash2 class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkDelete") }}</span>
        </div>

        <div class="h-4 w-px bg-border/40 mx-1" />

        <div class="h-6 px-2 gap-1 text-xs inline-flex items-center justify-center">
          <Pin class="h-3 w-3" />
        </div>
      </div>
    </div>

    <div
      :ref="(el) => props.setShortSizerRowEl(el as HTMLDivElement | null)"
      class="queue-selection-bar__sizer-row queue-selection-bar__sizer-row--short flex items-center justify-between gap-1.5 min-w-max font-medium"
    >
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-medium text-foreground whitespace-nowrap">
          {{ t("queue.selection.selectedCountShort", { count: props.selectedCount }) }}
        </span>

        <div class="flex items-center gap-1">
          <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
            <CheckSquare class="h-3 w-3" />
          </div>

          <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
            <Square class="h-3 w-3" />
          </div>

          <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center text-muted-foreground">
            <X class="h-3 w-3" />
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
          <Hourglass class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkWaitShort") }}</span>
        </div>

        <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
          <Play class="h-3 w-3" />
          <span class="whitespace-nowrap">{{ t("queue.actions.bulkResumeShort") }}</span>
        </div>

        <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
          <XCircle class="h-3 w-3" />
        </div>

        <div class="h-6 w-6 p-0 inline-flex items-center justify-center">
          <MoreHorizontal class="h-3 w-3" />
        </div>

        <div class="h-6 px-1.5 gap-1 text-xs inline-flex items-center justify-center">
          <Pin class="h-3 w-3" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queue-selection-bar__sizer {
  position: absolute;
  left: -100000px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
}
</style>

