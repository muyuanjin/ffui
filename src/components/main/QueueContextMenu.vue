<template>
  <Teleport to="body" :disabled="!teleportToBody">
    <div v-if="visible" ref="rootRef" :class="rootClass" data-testid="queue-context-menu-root" @contextmenu.prevent>
      <DropdownMenu :open="visible" @update:open="onOpenChange">
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="fixed z-40 h-1 w-1 p-0 opacity-0"
            :style="{ left: `${displayX}px`, top: `${displayY}px` }"
            aria-hidden="true"
            data-testid="queue-context-menu-anchor"
          />
        </DropdownMenuTrigger>

        <!-- Render inline (no Teleport) to keep tests + clamping predictable. -->
        <DropdownMenuContent
          class="z-50 min-w-[180px] overflow-hidden rounded-md border border-border bg-popover text-xs shadow-md py-1"
          :side-offset="4"
          :portal-disabled="true"
          :portal-force-mount="true"
          update-position-strategy="always"
          data-testid="queue-context-menu"
        >
          <template v-if="mode === 'single'">
            <DropdownMenuItem class="px-3 py-1.5 text-xs gap-2" @select="onInspect">
              <Eye class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("jobDetail.title") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              v-if="canCompare"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-compare"
              @select="onCompare"
            >
              <GitCompare class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("jobCompare.open") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-copy-input"
              @select="onCopyInputPath"
            >
              <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.copyInputPath") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canRevealInput"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-open-input"
              @select="onOpenInputFolder"
            >
              <FolderOpen class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.openInputFolder") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-copy-output"
              @select="onCopyOutputPath"
            >
              <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.copyOutputPath") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canRevealOutput"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-open-output"
              @select="onOpenOutputFolder"
            >
              <FolderOpen class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.openOutputFolder") }}
            </DropdownMenuItem>

            <DropdownMenuSeparator class="my-1 bg-border/40" />

            <DropdownMenuItem
              :disabled="!canResume"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-resume"
              @select="onResume"
            >
              <Play class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.resume") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canWait"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-wait"
              @select="onWait"
            >
              <Hourglass class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.wait") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canRestart"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-restart"
              @select="onRestart"
            >
              <RefreshCw class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.restart") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canCancel"
              class="px-3 py-1.5 text-xs gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="queue-context-menu-cancel"
              @select="onCancel"
            >
              <XCircle class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("app.actions.cancel") }}
            </DropdownMenuItem>

            <DropdownMenuSeparator class="my-1 bg-border/40" />

            <DropdownMenuItem
              :disabled="!canMove"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-move-top"
              @select="onMoveToTop"
            >
              <ArrowUpToLine class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkMoveToTop") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canMove"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-move-bottom"
              @select="onMoveToBottom"
            >
              <ArrowDownToLine class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkMoveToBottom") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canDeleteSingle"
              class="px-3 py-1.5 text-xs gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="queue-context-menu-remove"
              @select="onRemove"
            >
              <Trash2 class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkDelete") }}
            </DropdownMenuItem>
          </template>

          <template v-else>
            <DropdownMenuItem
              :disabled="!canBulkBase"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-copy-all-input"
              @select="onCopyInputPath"
            >
              <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.copyAllInputPaths") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkBase"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-copy-all-output"
              @select="onCopyOutputPath"
            >
              <Copy class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.copyAllOutputPaths") }}
            </DropdownMenuItem>

            <DropdownMenuSeparator class="my-1 bg-border/40" />

            <DropdownMenuItem
              :disabled="!canBulkResume"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-bulk-resume"
              @select="onResume"
            >
              <Play class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkResume") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkWait"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-bulk-wait"
              @select="onWait"
            >
              <Hourglass class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkWait") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkCancel"
              class="px-3 py-1.5 text-xs gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="queue-context-menu-bulk-cancel"
              @select="onCancel"
            >
              <XCircle class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkCancel") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkRestart"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-bulk-restart"
              @select="onRestart"
            >
              <RefreshCw class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkRestart") }}
            </DropdownMenuItem>

            <DropdownMenuSeparator class="my-1 bg-border/40" />

            <DropdownMenuItem
              :disabled="!canBulkMove"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-bulk-move-top"
              @select="onMoveToTop"
            >
              <ArrowUpToLine class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkMoveToTop") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkMove"
              class="px-3 py-1.5 text-xs gap-2"
              data-testid="queue-context-menu-bulk-move-bottom"
              @select="onMoveToBottom"
            >
              <ArrowDownToLine class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkMoveToBottom") }}
            </DropdownMenuItem>

            <DropdownMenuItem
              :disabled="!canBulkDelete"
              class="px-3 py-1.5 text-xs gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="queue-context-menu-bulk-remove"
              @select="onRemove"
            >
              <Trash2 class="h-4 w-4 opacity-80" aria-hidden="true" />
              {{ t("queue.actions.bulkDelete") }}
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { JobStatus, JobType, QueueMode } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eye,
  FolderOpen,
  GitCompare,
  Hourglass,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-vue-next";

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  mode: "single" | "bulk";
  /**
   * When true, the overlay container is teleported to `document.body` so the
   * fixed positioning is not affected by transformed ancestors (e.g. dialogs).
   */
  teleportToBody?: boolean;
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

const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);
const displayX = ref(props.x);
const displayY = ref(props.y);
const closeFromItem = ref(false);

const rootClass = computed(() => {
  // When the menu is teleported outside dialogs, it must stack above the dialog overlay.
  // Keep the previous stacking in the inline render to avoid changing unrelated contexts.
  const z = props.teleportToBody ? "z-[60]" : "z-40";
  return `fixed inset-0 ${z}`;
});

const requestClose = () => emit("close");
const closeMenu = () => {
  closeFromItem.value = true;
  requestClose();
};

const onOpenChange = (open: boolean) => {
  if (open) return;
  if (closeFromItem.value) {
    closeFromItem.value = false;
    return;
  }
  requestClose();
};

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

const clampToViewport = () => {
  const padding = 8;
  const menuEl =
    rootRef.value?.querySelector<HTMLElement>("[data-testid='queue-context-menu']") ??
    document.querySelector<HTMLElement>("[data-testid='queue-context-menu']") ??
    null;
  const rect = menuEl && typeof menuEl.getBoundingClientRect === "function" ? menuEl.getBoundingClientRect() : null;
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
    closeFromItem.value = false;
    displayX.value = props.x;
    displayY.value = props.y;

    if (!visible) return;
    await nextTick();
    await nextTick();
    clampToViewport();
  },
  { immediate: true },
);

const isQueueMode = computed(() => props.queueMode === "queue");
const status = computed<JobStatus | undefined>(() => props.jobStatus);

const canRevealInput = computed(() => props.mode === "single" && props.canRevealInputPath === true);
const canRevealOutput = computed(() => props.mode === "single" && props.canRevealOutputPath === true);

const isTerminalStatus = (value: JobStatus | undefined) =>
  value === "completed" || value === "failed" || value === "skipped" || value === "cancelled";

// 允许在显示模式下也能进行暂停/继续操作（仅影响单个任务状态，不改变队列优先级）。
const canWait = computed(() => props.mode === "single" && status.value === "processing");

const canResume = computed(() => props.mode === "single" && status.value === "paused");

const canRestart = computed(
  () =>
    props.mode === "single" && status.value !== undefined && status.value !== "completed" && status.value !== "skipped",
);

const canCancel = computed(
  () =>
    props.mode === "single" &&
    status.value !== undefined &&
    (status.value === "queued" || status.value === "processing" || status.value === "paused"),
);

const canMove = computed(() => props.mode === "single" && isQueueMode.value);

const canDeleteSingle = computed(() => props.mode === "single" && isTerminalStatus(status.value));

const canCompare = computed(() => {
  if (props.mode !== "single") return false;
  if (props.jobType !== "video") return false;
  return status.value === "processing" || status.value === "paused" || status.value === "completed";
});

const canBulkBase = computed(() => props.mode === "bulk" && props.hasSelection);

const canBulkCancel = computed(() => canBulkBase.value);
// 批量暂停/继续在显示模式下也允许；批量移动仍仅在队列模式下。
const canBulkWait = computed(() => canBulkBase.value);
const canBulkResume = computed(() => canBulkBase.value);
const canBulkRestart = computed(() => canBulkBase.value);
const canBulkMove = computed(() => canBulkBase.value && isQueueMode.value);
const canBulkDelete = computed(() => canBulkBase.value);
</script>
