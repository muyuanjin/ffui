<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const enabled = computed(() => props.appSettings.exitAutoWaitEnabled ?? true);

const DEFAULT_TIMEOUT_SECONDS = 5;
const timeoutInput = ref(String(props.appSettings.exitAutoWaitTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS));
watch(
  () => props.appSettings.exitAutoWaitTimeoutSeconds,
  (value) => {
    timeoutInput.value = String(value ?? DEFAULT_TIMEOUT_SECONDS);
  },
  { immediate: true },
);

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};

const updateTimeoutSeconds = (value: string | number) => {
  const text = String(value);
  timeoutInput.value = text;

  if (text.trim() === "") {
    updateSetting("exitAutoWaitTimeoutSeconds", undefined);
    return;
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return;
  updateSetting("exitAutoWaitTimeoutSeconds", parsed);
};

const crashRecoveryEnabled = computed(() => (props.appSettings.queuePersistenceMode ?? "none") !== "none");
</script>

<template>
  <div class="rounded border border-border/40 bg-muted/10 px-2 py-2" data-testid="settings-exit-auto-wait-section">
    <div class="flex items-start justify-between gap-3">
      <div class="space-y-0.5">
        <p class="text-[11px] font-medium text-foreground">
          {{ t("app.settings.exitAutoWaitTitle") }}
        </p>
        <p class="text-[10px] text-muted-foreground leading-snug">
          {{ t("app.settings.exitAutoWaitDescription") }}
        </p>
      </div>
      <Switch
        data-testid="settings-exit-auto-wait-enabled"
        :model-value="enabled"
        @update:model-value="(v) => updateSetting('exitAutoWaitEnabled', !!v)"
      />
    </div>

    <div v-if="enabled" class="mt-2 grid gap-1.5">
      <div class="flex items-center justify-between gap-2">
        <label class="text-[10px] text-muted-foreground">
          {{ t("app.settings.exitAutoWaitTimeoutLabel") }}
        </label>
        <Input
          data-testid="settings-exit-auto-wait-timeout"
          :model-value="timeoutInput"
          type="number"
          step="0.5"
          class="w-20 h-6 text-[10px] font-mono text-center"
          @update:model-value="(v) => updateTimeoutSeconds(v)"
        />
      </div>

      <p class="text-[9px] leading-snug text-muted-foreground">
        {{ t("app.settings.exitAutoWaitTimeoutHelp") }}
      </p>

      <p v-if="!crashRecoveryEnabled" class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
        {{ t("app.settings.exitAutoWaitRequiresCrashRecoveryHint") }}
      </p>
    </div>
  </div>
</template>
