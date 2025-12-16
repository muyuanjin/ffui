<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-40"
    @click="$emit('close')"
    @contextmenu.prevent
  >
    <div
      ref="menuRef"
      class="absolute z-50 min-w-[180px] rounded-md border border-border bg-popover text-xs shadow-md py-1"
      :style="{ left: `${displayX}px`, top: `${displayY}px` }"
      @click.stop
      data-testid="queue-context-menu"
    >
      <template v-if="mode === 'single'">
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
          @click="onInspect"
        >
          {{ t("jobDetail.title") }}
        </button>

        <button
          v-if="canCompare"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
          data-testid="queue-context-menu-compare"
          @click="onCompare"
        >
          {{ t("jobCompare.open") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canRevealInput"
          data-testid="queue-context-menu-open-input"
          @click="onOpenInputFolder"
        >
          {{ t("queue.actions.openInputFolder") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
          data-testid="queue-context-menu-copy-input"
          @click="onCopyInputPath"
        >
          {{ t("queue.actions.copyInputPath") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canRevealOutput"
          data-testid="queue-context-menu-open-output"
          @click="onOpenOutputFolder"
        >
          {{ t("queue.actions.openOutputFolder") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
          data-testid="queue-context-menu-copy-output"
          @click="onCopyOutputPath"
        >
          {{ t("queue.actions.copyOutputPath") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canWait"
          data-testid="queue-context-menu-wait"
          @click="onWait"
        >
          {{ t("queue.actions.wait") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canResume"
          data-testid="queue-context-menu-resume"
          @click="onResume"
        >
          {{ t("queue.actions.resume") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canRestart"
          data-testid="queue-context-menu-restart"
          @click="onRestart"
        >
          {{ t("queue.actions.restart") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/90 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canCancel"
          data-testid="queue-context-menu-cancel"
          @click="onCancel"
        >
          {{ t("app.actions.cancel") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canMove"
          data-testid="queue-context-menu-move-top"
          @click="onMoveToTop"
        >
          {{ t("queue.actions.bulkMoveToTop") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canMove"
          data-testid="queue-context-menu-move-bottom"
          @click="onMoveToBottom"
        >
          {{ t("queue.actions.bulkMoveToBottom") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/90 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canDeleteSingle"
          data-testid="queue-context-menu-remove"
          @click="onRemove"
        >
          {{ t("queue.actions.bulkDelete") }}
        </button>
      </template>

      <template v-else>
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkBase"
          data-testid="queue-context-menu-copy-all-input"
          @click="onCopyInputPath"
        >
          {{ t("queue.actions.copyAllInputPaths") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkBase"
          data-testid="queue-context-menu-copy-all-output"
          @click="onCopyOutputPath"
        >
          {{ t("queue.actions.copyAllOutputPaths") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkWait"
          data-testid="queue-context-menu-bulk-wait"
          @click="onWait"
        >
          {{ t("queue.actions.bulkWait") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkResume"
          data-testid="queue-context-menu-bulk-resume"
          @click="onResume"
        >
          {{ t("queue.actions.bulkResume") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkCancel"
          data-testid="queue-context-menu-bulk-cancel"
          @click="onCancel"
        >
          {{ t("queue.actions.bulkCancel") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkRestart"
          data-testid="queue-context-menu-bulk-restart"
          @click="onRestart"
        >
          {{ t("queue.actions.bulkRestart") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkMove"
          data-testid="queue-context-menu-bulk-move-top"
          @click="onMoveToTop"
        >
          {{ t("queue.actions.bulkMoveToTop") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkMove"
          data-testid="queue-context-menu-bulk-move-bottom"
          @click="onMoveToBottom"
        >
          {{ t("queue.actions.bulkMoveToBottom") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/90 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkDelete"
          data-testid="queue-context-menu-bulk-remove"
          @click="onRemove"
        >
          {{ t("queue.actions.bulkDelete") }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { JobStatus, JobType, QueueMode } from "@/types";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  mode: "single" | "bulk";
  jobStatus?: JobStatus;
  jobType?: JobType;
  queueMode: QueueMode;
  hasSelection: boolean;
  canRevealInputPath?: boolean;
  canRevealOutputPath?: boolean;
}>();

const emit = defineEmits<{
  (e: "inspect"): void;
  (e: "compare"): void;
  (e: "open-input-folder"): void;
  (e: "open-output-folder"): void;
  (e: "copy-input-path"): void;
  (e: "copy-output-path"): void;
  (e: "wait"): void;
  (e: "resume"): void;
  (e: "restart"): void;
  (e: "cancel"): void;
  (e: "move-to-top"): void;
  (e: "move-to-bottom"): void;
  (e: "remove"): void;
  (e: "close"): void;
}>();
const closeMenu = () => emit("close");
const onInspect = () => {
  emit("inspect");
  closeMenu();
};
const onCompare = () => {
  emit("compare");
  closeMenu();
};
const onOpenInputFolder = () => {
  if (!canRevealInput.value) return;
  emit("open-input-folder");
  closeMenu();
};
const onOpenOutputFolder = () => {
  if (!canRevealOutput.value) return;
  emit("open-output-folder");
  closeMenu();
};
const onCopyInputPath = () => {
  emit("copy-input-path");
  closeMenu();
};
const onCopyOutputPath = () => {
  emit("copy-output-path");
  closeMenu();
};
const onWait = () => {
  if (props.mode === "single" && !canWait.value) return;
  if (props.mode === "single" || canBulkWait.value) emit("wait");
  closeMenu();
};
const onResume = () => {
  if (props.mode === "single" && !canResume.value) return;
  if (props.mode === "single" || canBulkResume.value) emit("resume");
  closeMenu();
};
const onRestart = () => {
  if (props.mode === "single" && !canRestart.value) return;
  if (props.mode === "single" || canBulkRestart.value) emit("restart");
  closeMenu();
};
const onCancel = () => {
  if (props.mode === "single" && !canCancel.value) return;
  if (props.mode === "single" || canBulkCancel.value) emit("cancel");
  closeMenu();
};
const onMoveToTop = () => {
  if (props.mode === "single" && !canMove.value) return;
  if (props.mode === "single" || canBulkMove.value) emit("move-to-top");
  closeMenu();
};
const onMoveToBottom = () => {
  if (props.mode === "single" && !canMove.value) return;
  if (props.mode === "single" || canBulkMove.value) emit("move-to-bottom");
  closeMenu();
};
const onRemove = () => {
  if (props.mode === "single" && !canDeleteSingle.value) return;
  if (props.mode === "bulk" && !canBulkDelete.value) return;
  emit("remove");
  closeMenu();
};

const { t } = useI18n();
const menuRef = ref<HTMLElement | null>(null);
const displayX = ref(props.x);
const displayY = ref(props.y);

const clampToViewport = () => {
  const padding = 8;
  const menuEl = menuRef.value;
  const rect = menuEl?.getBoundingClientRect();
  const menuWidth = rect?.width || menuEl?.offsetWidth || 0;
  const menuHeight = rect?.height || menuEl?.offsetHeight || 0;

  const maxLeft = Math.max(padding, window.innerWidth - menuWidth - padding);
  const maxTop = Math.max(padding, window.innerHeight - menuHeight - padding);

  displayX.value = Math.min(Math.max(props.x, padding), maxLeft);
  displayY.value = Math.min(Math.max(props.y, padding), maxTop);
};

watch(
  () => [props.visible, props.x, props.y],
  async ([visible]) => {
    displayX.value = props.x;
    displayY.value = props.y;

    if (!visible) return;
    await nextTick();
    clampToViewport();
  },
  { immediate: true },
);

const isQueueMode = computed(() => props.queueMode === "queue");
const status = computed<JobStatus | undefined>(() => props.jobStatus);

const canRevealInput = computed(
  () => props.mode === "single" && props.canRevealInputPath === true,
);
const canRevealOutput = computed(
  () => props.mode === "single" && props.canRevealOutputPath === true,
);

const isTerminalStatus = (value: JobStatus | undefined) =>
  value === "completed" ||
  value === "failed" ||
  value === "skipped" ||
  value === "cancelled";

// 允许在显示模式下也能进行暂停/继续操作（仅影响单个任务状态，不改变队列优先级）。
const canWait = computed(
  () => props.mode === "single" && status.value === "processing",
);

const canResume = computed(
  () => props.mode === "single" && status.value === "paused",
);

const canRestart = computed(
  () =>
    props.mode === "single" &&
    status.value !== undefined &&
    status.value !== "completed" &&
    status.value !== "skipped",
);

const canCancel = computed(
  () =>
    props.mode === "single" &&
    status.value !== undefined &&
    (status.value === "waiting" ||
      status.value === "queued" ||
      status.value === "processing" ||
      status.value === "paused"),
);

const canMove = computed(() => props.mode === "single" && isQueueMode.value);

const canDeleteSingle = computed(
  () => props.mode === "single" && isTerminalStatus(status.value),
);

const canCompare = computed(() => {
  if (props.mode !== "single") return false;
  if (props.jobType !== "video") return false;
  return (
    status.value === "processing" ||
    status.value === "paused" ||
    status.value === "completed"
  );
});

const canBulkBase = computed(
  () => props.mode === "bulk" && props.hasSelection,
);

const canBulkCancel = computed(() => canBulkBase.value);
// 批量暂停/继续在显示模式下也允许；批量移动仍仅在队列模式下。
const canBulkWait = computed(() => canBulkBase.value);
const canBulkResume = computed(() => canBulkBase.value);
const canBulkRestart = computed(() => canBulkBase.value);
const canBulkMove = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkDelete = computed(() => canBulkBase.value);
</script>
