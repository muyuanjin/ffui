<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OctagonX, TriangleAlert } from "lucide-vue-next";

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

const alertClass = (variant: AlertVariant) =>
  variant === "warning"
    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200"
    : "border-destructive/60 bg-destructive/10 text-destructive";
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
      <Alert
        v-for="alert in alerts"
        :key="alert.id"
        :variant="alert.variant === 'error' ? 'destructive' : 'default'"
        class="text-xs pr-10"
        :class="alertClass(alert.variant)"
        role="alert"
        aria-live="polite"
      >
        <TriangleAlert
          v-if="alert.variant === 'warning'"
          class="h-4 w-4"
          aria-hidden="true"
        />
        <OctagonX
          v-else
          class="h-4 w-4"
          aria-hidden="true"
        />
        <div>
          <AlertTitle class="text-xs">
            {{ alert.id }}
          </AlertTitle>
          <AlertDescription class="text-xs whitespace-pre-wrap">
            {{ alert.message }}
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          class="absolute top-2 right-2 text-xs"
          :aria-label="`Dismiss ${alert.id} alert`"
          @click="alert.onClose()"
        >
          ×
        </Button>
      </Alert>
    </div>
  </section>
</template>
