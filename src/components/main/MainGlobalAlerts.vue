<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OctagonX, TriangleAlert, X } from "lucide-vue-next";

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

const { t } = useI18n();

const alertTitle = (id: string) => {
  switch (id) {
    case "queue":
      return t("app.tabs.queue");
    case "media":
      return t("app.tabs.media");
    case "settings":
      return t("app.tabs.settings");
    default:
      return id;
  }
};

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
    ? "border-amber-500/40 bg-card text-amber-700 dark:text-amber-200"
    : "border-destructive/60 bg-card text-destructive";
</script>

<template>
  <section
    v-if="alerts.length > 0"
    class="relative shrink-0 h-0"
    data-testid="global-alerts"
    role="region"
    aria-label="Global alerts"
  >
    <div class="pointer-events-none absolute inset-x-0 top-2 z-50 px-4">
      <div class="pointer-events-auto max-w-4xl mx-auto space-y-2 max-h-32 overflow-auto">
        <Alert
          v-for="alert in alerts"
          :key="alert.id"
          :variant="alert.variant === 'error' ? 'destructive' : 'default'"
          class="text-xs pr-10 shadow-sm"
          :class="alertClass(alert.variant)"
          role="alert"
          aria-live="polite"
        >
          <TriangleAlert v-if="alert.variant === 'warning'" class="h-4 w-4" aria-hidden="true" />
          <OctagonX v-else class="h-4 w-4" aria-hidden="true" />
          <div>
            <AlertTitle class="text-xs" :data-testid="`global-alert-title-${alert.id}`">
              {{ alertTitle(alert.id) }}
            </AlertTitle>
            <AlertDescription class="text-xs whitespace-pre-wrap">
              {{ alert.message }}
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            class="absolute top-2 right-2"
            :data-testid="`global-alert-dismiss-${alert.id}`"
            data-alert-close
            :aria-label="`Dismiss ${alert.id} alert`"
            @click="alert.onClose()"
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </Button>
        </Alert>
      </div>
    </div>
  </section>
</template>
