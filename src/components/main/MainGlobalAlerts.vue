<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";

type AlertVariant = "error" | "warning";

const props = defineProps<{
  queueError: string | null;
  mediaInspectError: string | null;
  settingsSaveError: string | null;
}>();

const emit = defineEmits<{
  clearQueueError: [];
  clearMediaInspectError: [];
  clearSettingsSaveError: [];
}>();

const alerts = computed(() => {
  const list: { id: string; message: string; variant: AlertVariant; onClose: () => void }[] = [];

  if (props.queueError) {
    list.push({
      id: "queue",
      message: props.queueError,
      variant: "warning",
      onClose: () => emit("clearQueueError"),
    });
  }

  if (props.mediaInspectError) {
    list.push({
      id: "media",
      message: props.mediaInspectError,
      variant: "error",
      onClose: () => emit("clearMediaInspectError"),
    });
  }

  if (props.settingsSaveError) {
    list.push({
      id: "settings",
      message: props.settingsSaveError,
      variant: "error",
      onClose: () => emit("clearSettingsSaveError"),
    });
  }

  return list;
});

const alertClass = (variant: AlertVariant) => {
  if (variant === "warning") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }

  return "border-destructive/60 bg-destructive/10 text-destructive";
};
</script>

<template>
  <section
    v-if="alerts.length > 0"
    class="shrink-0 px-4 pt-2"
    data-testid="global-alerts"
    role="region"
    aria-label="Global alerts"
  >
    <div class="max-w-4xl mx-auto space-y-2 max-h-32 overflow-auto">
      <div
        v-for="alert in alerts"
        :key="alert.id"
        class="rounded-md border text-xs px-3 py-2 flex items-start gap-2"
        :class="alertClass(alert.variant)"
        role="alert"
        aria-live="polite"
      >
        <span class="mt-0.5 select-none">!</span>
        <span class="whitespace-pre-wrap flex-1">{{ alert.message }}</span>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 -my-0.5"
          :aria-label="`Dismiss ${alert.id} alert`"
          @click="alert.onClose()"
        >
          ×
        </Button>
      </div>
    </div>
  </section>
</template>

