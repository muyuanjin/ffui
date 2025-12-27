<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QueueStartupHintKind } from "@/types";
import { dismissQueueStartupHint, resumeStartupQueue } from "@/lib/backend.queue-startup";
import { resumeTranscodeJobsBulk } from "@/lib/backend";

const props = defineProps<{
  open: boolean;
  kind: QueueStartupHintKind;
  autoPausedJobCount: number;
  pausedJobIds?: string[];
  refreshQueueFromBackend?: (() => Promise<void>) | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const working = ref(false);
watch(
  () => props.open,
  (open) => {
    if (open) working.value = false;
  },
);

const descriptionKeyForKind = (kind: QueueStartupHintKind) => {
  if (kind === "pauseOnExit") return "queue.startupHint.descriptionPauseOnExit";
  if (kind === "crashOrKill") return "queue.startupHint.descriptionCrashOrKill";
  if (kind === "pausedQueue") return "queue.startupHint.descriptionPausedQueue";
  return "queue.startupHint.descriptionNormalRestart";
};

const pausedCount = computed(() => (Number.isFinite(props.autoPausedJobCount) ? props.autoPausedJobCount : 0));

const handleDismiss = async () => {
  if (working.value) return;
  try {
    await dismissQueueStartupHint();
  } catch (error) {
    console.error("Failed to dismiss queue startup hint:", error);
  } finally {
    emit("update:open", false);
  }
};

const handleResume = async () => {
  if (working.value) return;
  working.value = true;
  try {
    const resumed = await resumeStartupQueue();
    if (resumed <= 0 && Array.isArray(props.pausedJobIds) && props.pausedJobIds.length > 0) {
      await resumeTranscodeJobsBulk(props.pausedJobIds);
      await dismissQueueStartupHint();
    }
    await props.refreshQueueFromBackend?.();
    emit("update:open", false);
  } catch (error) {
    working.value = false;
    console.error("Failed to resume startup queue:", error);
  }
};

const handleUpdateOpen = async (nextOpen: boolean) => {
  if (!nextOpen) {
    await handleDismiss();
    return;
  }
  emit("update:open", nextOpen);
};
</script>

<template>
  <Dialog :open="open" @update:open="handleUpdateOpen">
    <DialogContent class="max-w-md" :hide-close="working" :overlay-closable="!working">
      <DialogHeader>
        <DialogTitle>{{ t("queue.startupHint.title") }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ t(descriptionKeyForKind(kind), { count: pausedCount }) }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="working" class="text-[11px] text-muted-foreground">
        {{ t("queue.startupHint.resuming") }}
      </div>

      <DialogFooter class="gap-2">
        <Button
          data-testid="queue-startup-dismiss"
          variant="outline"
          size="sm"
          :disabled="working"
          @click="handleDismiss"
        >
          {{ t("queue.startupHint.dismiss") }}
        </Button>
        <Button
          data-testid="queue-startup-resume"
          size="sm"
          class="bg-emerald-600 hover:bg-emerald-700 text-white"
          :disabled="working || pausedCount <= 0"
          @click="handleResume"
        >
          {{ t("queue.startupHint.actionResumeTranscoding") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
