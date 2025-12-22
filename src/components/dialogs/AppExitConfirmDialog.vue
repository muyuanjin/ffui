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
import { exitAppNow, exitAppWithAutoWait, resetExitPrompt } from "@/lib/backend";

const props = defineProps<{
  open: boolean;
  processingJobCount: number;
  timeoutSeconds: number;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const working = ref(false);
watch(
  () => props.open,
  (open) => {
    if (open) {
      working.value = false;
    }
  },
);

const DEFAULT_TIMEOUT_SECONDS = 5;
const timeoutSeconds = computed(() => {
  const seconds = Number(props.timeoutSeconds);
  if (!Number.isFinite(seconds)) return DEFAULT_TIMEOUT_SECONDS;
  return seconds;
});
const timeoutIsInfinite = computed(() => timeoutSeconds.value <= 0);
const timeoutSecondsLabel = computed(() => Math.max(0, Math.round(timeoutSeconds.value)));

const handleCancel = async () => {
  if (working.value) return;
  try {
    await resetExitPrompt();
  } catch (error) {
    console.error("Failed to reset exit prompt:", error);
  } finally {
    emit("update:open", false);
  }
};

const handlePauseAndExit = async () => {
  if (working.value) return;
  working.value = true;
  try {
    await exitAppWithAutoWait();
  } catch (error) {
    working.value = false;
    console.error("Failed to exit with auto-wait:", error);
  }
};

const handleExitNow = async () => {
  if (working.value) return;
  working.value = true;
  try {
    await exitAppNow();
  } catch (error) {
    working.value = false;
    console.error("Failed to exit immediately:", error);
  }
};

const handleUpdateOpen = async (nextOpen: boolean) => {
  if (!nextOpen) {
    await handleCancel();
    return;
  }
  emit("update:open", nextOpen);
};
</script>

<template>
  <Dialog :open="open" @update:open="handleUpdateOpen">
    <DialogContent class="max-w-md" :hide-close="working" :overlay-closable="!working">
      <DialogHeader>
        <DialogTitle>{{ t("app.exitConfirm.title") }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ t("app.exitConfirm.description", { count: processingJobCount }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-2">
        <p v-if="working" class="text-[11px] text-muted-foreground">
          {{ t("app.exitConfirm.pausing") }}
        </p>
        <p v-if="timeoutIsInfinite" class="text-[10px] text-muted-foreground">
          {{ t("app.exitConfirm.pauseTimeoutInfiniteHint") }}
        </p>
        <p v-else class="text-[10px] text-muted-foreground">
          {{ t("app.exitConfirm.pauseTimeoutHint", { seconds: timeoutSecondsLabel }) }}
        </p>
      </div>

      <DialogFooter class="gap-2">
        <Button data-testid="exit-confirm-cancel" variant="outline" size="sm" :disabled="working" @click="handleCancel">
          {{ t("app.actions.cancel") }}
        </Button>
        <Button
          data-testid="exit-confirm-pause-and-exit"
          size="sm"
          class="bg-emerald-600 hover:bg-emerald-700 text-white"
          :disabled="working"
          @click="handlePauseAndExit"
        >
          {{ t("app.exitConfirm.pauseAndExit") }}
        </Button>
        <Button
          data-testid="exit-confirm-exit-now"
          variant="destructive"
          size="sm"
          :disabled="working"
          @click="handleExitNow"
        >
          {{ t("app.exitConfirm.exitNow") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
