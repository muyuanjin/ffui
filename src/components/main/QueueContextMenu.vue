<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-40"
    @click="$emit('close')"
    @contextmenu.prevent
  >
    <div
      class="absolute z-50 min-w-[180px] rounded-md border border-border bg-popover text-xs shadow-md py-1"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @click.stop
      data-testid="queue-context-menu"
    >
      <template v-if="mode === 'single'">
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
          @click="
            () => {
              $emit('inspect');
              $emit('close');
            }
          "
        >
          {{ t("jobDetail.title") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canWait"
          data-testid="queue-context-menu-wait"
          @click="
            () => {
              if (!canWait) return;
              $emit('wait');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.wait") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canResume"
          data-testid="queue-context-menu-resume"
          @click="
            () => {
              if (!canResume) return;
              $emit('resume');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.resume") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canRestart"
          data-testid="queue-context-menu-restart"
          @click="
            () => {
              if (!canRestart) return;
              $emit('restart');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.restart") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canCancel"
          data-testid="queue-context-menu-cancel"
          @click="
            () => {
              if (!canCancel) return;
              $emit('cancel');
              $emit('close');
            }
          "
        >
          {{ t("app.actions.cancel") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canMove"
          data-testid="queue-context-menu-move-top"
          @click="
            () => {
              if (!canMove) return;
              $emit('move-to-top');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkMoveToTop") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canMove"
          data-testid="queue-context-menu-move-bottom"
          @click="
            () => {
              if (!canMove) return;
              $emit('move-to-bottom');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkMoveToBottom") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive hover:text-destructive-foreground"
          data-testid="queue-context-menu-remove"
          @click="
            () => {
              $emit('remove');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkDelete") }}
        </button>
      </template>

      <template v-else>
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkCancel"
          data-testid="queue-context-menu-bulk-cancel"
          @click="
            () => {
              if (!canBulkCancel) return;
              $emit('cancel');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkCancel") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkWait"
          data-testid="queue-context-menu-bulk-wait"
          @click="
            () => {
              if (!canBulkWait) return;
              $emit('wait');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkWait") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkResume"
          data-testid="queue-context-menu-bulk-resume"
          @click="
            () => {
              if (!canBulkResume) return;
              $emit('resume');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkResume") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkRestart"
          data-testid="queue-context-menu-bulk-restart"
          @click="
            () => {
              if (!canBulkRestart) return;
              $emit('restart');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkRestart") }}
        </button>

        <div class="h-px my-1 bg-border/40" />

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkMove"
          data-testid="queue-context-menu-bulk-move-top"
          @click="
            () => {
              if (!canBulkMove) return;
              $emit('move-to-top');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkMoveToTop") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkMove"
          data-testid="queue-context-menu-bulk-move-bottom"
          @click="
            () => {
              if (!canBulkMove) return;
              $emit('move-to-bottom');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkMoveToBottom") }}
        </button>

        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!canBulkDelete"
          data-testid="queue-context-menu-bulk-remove"
          @click="
            () => {
              if (!canBulkDelete) return;
              $emit('remove');
              $emit('close');
            }
          "
        >
          {{ t("queue.actions.bulkDelete") }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { JobStatus, QueueMode } from "@/types";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  mode: "single" | "bulk";
  jobStatus?: JobStatus;
  queueMode: QueueMode;
  hasSelection: boolean;
}>();

const emit = defineEmits<{
  (e: "inspect"): void;
  (e: "wait"): void;
  (e: "resume"): void;
  (e: "restart"): void;
  (e: "cancel"): void;
  (e: "move-to-top"): void;
  (e: "move-to-bottom"): void;
  (e: "remove"): void;
  (e: "close"): void;
}>();
void emit;

const { t } = useI18n();

const isQueueMode = computed(() => props.queueMode === "queue");
const status = computed<JobStatus | undefined>(() => props.jobStatus);

const canWait = computed(
  () =>
    props.mode === "single" &&
    isQueueMode.value &&
    status.value === "processing",
);

const canResume = computed(
  () =>
    props.mode === "single" &&
    isQueueMode.value &&
    status.value === "paused",
);

const canRestart = computed(
  () =>
    props.mode === "single" &&
    isQueueMode.value &&
    status.value !== undefined &&
    status.value !== "completed" &&
    status.value !== "skipped",
);

const canCancel = computed(
  () =>
    props.mode === "single" &&
    isQueueMode.value &&
    status.value !== undefined &&
    (status.value === "waiting" ||
      status.value === "queued" ||
      status.value === "processing" ||
      status.value === "paused"),
);

const canMove = computed(() => props.mode === "single" && isQueueMode.value);

const canBulkBase = computed(
  () => props.mode === "bulk" && props.hasSelection,
);

const canBulkCancel = computed(() => canBulkBase.value);
const canBulkWait = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkResume = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkRestart = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkMove = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkDelete = computed(() => canBulkBase.value);
</script>

