<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
	import { Button } from "@/components/ui/button";
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
	import { useI18n } from "vue-i18n";
	import type { QueueMode } from "@/types";
	import QueueSelectionBarSizers from "./QueueSelectionBarSizers.vue";
	import { CheckSquare, Square, X, Hourglass, Play, RefreshCw, ArrowUp, ArrowDown, XCircle, Trash2, Pin, PinOff, MoreHorizontal } from "lucide-vue-next";
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
	  (e: "bulk-restart" | "bulk-move-to-top" | "bulk-move-to-bottom" | "bulk-delete"): void;
	  (e: "toggle-selection-bar-pinned"): void;
	}>();
	const { t, locale } = useI18n();
	const emitTogglePin = () => emit("toggle-selection-bar-pinned");
	const viewportEl = ref<HTMLDivElement | null>(null);
	const fullSizerRowEl = ref<HTMLDivElement | null>(null);
	const shortSizerRowEl = ref<HTMLDivElement | null>(null);
	const setFullSizerRowEl = (el: HTMLDivElement | null) => {
	  fullSizerRowEl.value = el;
	};
	const setShortSizerRowEl = (el: HTMLDivElement | null) => {
	  shortSizerRowEl.value = el;
	};
	const density = ref<"full" | "short" | "icon">("full");
	const moreOpen = ref(false);

const runMoreAction = (
  action: "bulk-restart" | "bulk-move-to-top" | "bulk-move-to-bottom" | "bulk-delete",
) => {
  moreOpen.value = false;
  emit(action);
};

let resizeObserver: ResizeObserver | null = null;
const updateDensityFromOverflow = () => {
  const viewport = viewportEl.value;
  const fullSizerRow = fullSizerRowEl.value;
  const shortSizerRow = shortSizerRowEl.value;
  if (!viewport || !fullSizerRow || !shortSizerRow) return;

  const viewportWidth = viewport.clientWidth;
  const fullContentWidth = fullSizerRow.scrollWidth;
  const shortContentWidth = shortSizerRow.scrollWidth;
  // JSDOM / hidden states may report 0; avoid flapping on invalid measurements.
  if (viewportWidth === 0 || fullContentWidth === 0 || shortContentWidth === 0) return;

  // Small tolerance to avoid 1px oscillation and ensure we densify before a scrollbar appears.
  const tolerancePx = 12;
  if (fullContentWidth <= viewportWidth - tolerancePx) {
    density.value = "full";
  } else if (shortContentWidth <= viewportWidth - tolerancePx) {
    density.value = "short";
  } else {
    density.value = "icon";
  }
};

onMounted(() => {
  updateDensityFromOverflow();
  window.addEventListener("resize", updateDensityFromOverflow, { passive: true });
  if (typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => updateDensityFromOverflow());
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
  if (fullSizerRowEl.value) resizeObserver.observe(fullSizerRowEl.value);
  if (shortSizerRowEl.value) resizeObserver.observe(shortSizerRowEl.value);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateDensityFromOverflow);
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(
  [() => props.selectedCount, () => props.queueMode, locale],
  async () => {
    await nextTick();
    updateDensityFromOverflow();
  },
  { flush: "post" },
);
</script>

<template>
  <div
    class="queue-selection-bar border-t border-border/60 px-3 py-1.5 bg-accent/5"
    :data-density="density"
  >
    <div
      ref="viewportEl"
      class="queue-selection-bar__viewport"
      :class="density === 'icon' ? 'overflow-x-auto' : 'overflow-x-hidden'"
    >
      <div
        :class="[
          'queue-selection-bar__row flex items-center justify-between min-w-max',
          density === 'full' ? 'gap-2' : 'gap-1.5',
        ]"
      >
        <div class="flex items-center gap-2 shrink-0">
          <span
            class="text-xs font-medium text-foreground whitespace-nowrap"
            :title="t('queue.selection.selectedCount', { count: props.selectedCount })"
            data-testid="queue-selection-count"
          >
            <span v-if="density === 'full'" class="queue-selection-bar__count-full">
              {{ t("queue.selection.selectedCount", { count: props.selectedCount }) }}
            </span>
            <span v-else-if="density === 'short'" class="queue-selection-bar__count-short">
              {{ t("queue.selection.selectedCountShort", { count: props.selectedCount }) }}
            </span>
            <span v-else class="queue-selection-bar__count-icon" aria-hidden="true">
              {{ props.selectedCount }}
            </span>
          </span>

          <div class="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="queue-selection-bar__button h-6 gap-1 text-xs"
              :class="density === 'full' ? 'px-2' : 'px-1.5'"
              @click="emit('select-all-visible-jobs')"
              :title="t('queue.selection.selectAll')"
              :aria-label="t('queue.selection.selectAll')"
            >
              <CheckSquare class="h-3 w-3" />
              <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
                {{ t("queue.selection.selectAll") }}
              </span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="queue-selection-bar__button h-6 gap-1 text-xs"
              :class="density === 'full' ? 'px-2' : 'px-1.5'"
              @click="emit('invert-selection')"
              :title="t('queue.selection.invert')"
              :aria-label="t('queue.selection.invert')"
            >
              <Square class="h-3 w-3" />
              <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
                {{ t("queue.selection.invert") }}
              </span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="queue-selection-bar__button h-6 gap-1 text-xs text-muted-foreground"
              :class="density === 'full' ? 'px-2' : 'px-1.5'"
              @click="emit('clear-selection')"
              :title="t('queue.selection.clear')"
              :aria-label="t('queue.selection.clear')"
            >
              <X class="h-3 w-3" />
              <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
                {{ t("queue.selection.clear") }}
              </span>
            </Button>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="queue-selection-bar__button h-6 gap-1 text-xs"
            :class="density === 'full' ? 'px-2' : 'px-1.5'"
            @click="emit('bulk-wait')"
            :title="t('queue.actions.bulkWait')"
            :aria-label="t('queue.actions.bulkWait')"
          >
            <Hourglass class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkWait") }}
            </span>
            <span v-else-if="density === 'short'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkWaitShort") }}
            </span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="queue-selection-bar__button h-6 gap-1 text-xs"
            :class="density === 'full' ? 'px-2' : 'px-1.5'"
            @click="emit('bulk-resume')"
            :title="t('queue.actions.bulkResume')"
            :aria-label="t('queue.actions.bulkResume')"
          >
            <Play class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkResume") }}
            </span>
            <span v-else-if="density === 'short'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkResumeShort") }}
            </span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="queue-selection-bar__button h-6 gap-1 text-xs"
            :class="density === 'full' ? 'px-2' : 'px-1.5'"
            @click="emit('bulk-cancel')"
            :title="t('queue.actions.bulkCancel')"
            :aria-label="t('queue.actions.bulkCancel')"
          >
            <XCircle class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkCancel") }}
            </span>
          </Button>

	          <Button
	            type="button"
	            variant="ghost"
	            size="sm"
	            v-if="density === 'full'"
	            class="queue-selection-bar__button h-6 gap-1 text-xs"
	            :class="density === 'full' ? 'px-2' : 'px-1.5'"
	            :disabled="props.queueMode !== 'queue'"
	            @click="emit('bulk-restart')"
            :title="t('queue.actions.bulkRestart')"
            :aria-label="t('queue.actions.bulkRestart')"
          >
            <RefreshCw class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkRestart") }}
            </span>
          </Button>

          <div v-if="density === 'full'" class="h-4 w-px bg-border/40 mx-1" />

	          <Button
	            type="button"
	            variant="ghost"
	            size="sm"
	            v-if="density === 'full'"
	            class="queue-selection-bar__button h-6 gap-1 text-xs"
	            :class="density === 'full' ? 'px-2' : 'px-1.5'"
	            :disabled="props.queueMode !== 'queue'"
	            @click="emit('bulk-move-to-top')"
            :title="t('queue.actions.bulkMoveToTop')"
            :aria-label="t('queue.actions.bulkMoveToTop')"
          >
            <ArrowUp class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkMoveToTop") }}
            </span>
          </Button>

	          <Button
	            type="button"
	            variant="ghost"
	            size="sm"
	            v-if="density === 'full'"
	            class="queue-selection-bar__button h-6 gap-1 text-xs"
	            :class="density === 'full' ? 'px-2' : 'px-1.5'"
	            :disabled="props.queueMode !== 'queue'"
	            @click="emit('bulk-move-to-bottom')"
            :title="t('queue.actions.bulkMoveToBottom')"
            :aria-label="t('queue.actions.bulkMoveToBottom')"
          >
            <ArrowDown class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkMoveToBottom") }}
            </span>
          </Button>

          <div v-if="density === 'full'" class="h-4 w-px bg-border/40 mx-1" />

	          <Button
	            type="button"
	            variant="ghost"
	            size="sm"
	            v-if="density === 'full'"
	            class="queue-selection-bar__button h-6 gap-1 text-xs text-destructive/80 hover:text-destructive"
	            :class="density === 'full' ? 'px-2' : 'px-1.5'"
	            @click="emit('bulk-delete')"
	            :title="t('queue.actions.bulkDelete')"
	            :aria-label="t('queue.actions.bulkDelete')"
          >
            <Trash2 class="h-3 w-3" />
            <span v-if="density === 'full'" class="queue-selection-bar__label whitespace-nowrap">
              {{ t("queue.actions.bulkDelete") }}
            </span>
	          </Button>

	          <div v-if="density === 'full'" class="h-4 w-px bg-border/40 mx-1" />

	          <Dialog v-if="density !== 'full'" v-model:open="moreOpen">
	            <DialogTrigger as-child>
	              <Button
	                type="button"
	                variant="ghost"
	                size="sm"
	                class="h-6 w-6 p-0"
	                :title="t('queue.selection.moreActions')"
	                :aria-label="t('queue.selection.moreActions')"
	              >
	                <MoreHorizontal class="h-3 w-3" />
	              </Button>
	            </DialogTrigger>
	            <DialogContent class="sm:max-w-[420px]">
	              <DialogHeader>
	                <DialogTitle>{{ t("queue.selection.moreActions") }}</DialogTitle>
	              </DialogHeader>
	              <div class="grid gap-2">
	                <Button
	                  type="button"
	                  variant="outline"
	                  size="sm"
	                  :disabled="props.queueMode !== 'queue'"
	                  @click="runMoreAction('bulk-restart')"
	                >
	                  <RefreshCw class="h-4 w-4" />
	                  <span class="truncate">{{ t("queue.actions.bulkRestart") }}</span>
	                </Button>
	                <Button
	                  type="button"
	                  variant="outline"
	                  size="sm"
	                  :disabled="props.queueMode !== 'queue'"
	                  @click="runMoreAction('bulk-move-to-top')"
	                >
	                  <ArrowUp class="h-4 w-4" />
	                  <span class="truncate">{{ t("queue.actions.bulkMoveToTop") }}</span>
	                </Button>
	                <Button
	                  type="button"
	                  variant="outline"
	                  size="sm"
	                  :disabled="props.queueMode !== 'queue'"
	                  @click="runMoreAction('bulk-move-to-bottom')"
	                >
	                  <ArrowDown class="h-4 w-4" />
	                  <span class="truncate">{{ t("queue.actions.bulkMoveToBottom") }}</span>
	                </Button>
	                <Button
	                  type="button"
	                  variant="outline"
	                  size="sm"
	                  class="text-destructive hover:text-destructive"
	                  @click="runMoreAction('bulk-delete')"
	                >
	                  <Trash2 class="h-4 w-4" />
	                  <span class="truncate">{{ t("queue.actions.bulkDelete") }}</span>
	                </Button>
	              </div>
	            </DialogContent>
	          </Dialog>

	          <Button
	            type="button"
	            variant="ghost"
	            size="sm"
            class="queue-selection-bar__button h-6 gap-1 text-xs"
            :class="[
              density === 'full' ? 'px-2' : 'px-1.5',
              { 'text-primary': props.selectionBarPinned },
            ]"
            @click="emitTogglePin"
            :title="props.selectionBarPinned ? t('queue.selection.unpin') : t('queue.selection.pin')"
            :aria-label="props.selectionBarPinned ? t('queue.selection.unpin') : t('queue.selection.pin')"
          >
            <PinOff v-if="props.selectionBarPinned" class="h-3 w-3" />
            <Pin v-else class="h-3 w-3" />
          </Button>
        </div>
      </div>
	    </div>

	    <QueueSelectionBarSizers
	      :selected-count="props.selectedCount"
	      :set-full-sizer-row-el="setFullSizerRowEl"
	      :set-short-sizer-row-el="setShortSizerRowEl"
	    />
	  </div>
	</template>

<style scoped>
.queue-selection-bar {
  position: relative;
}

	.queue-selection-bar__viewport {
	  min-width: 0;
	}
	</style>
