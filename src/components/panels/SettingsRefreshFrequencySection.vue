<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

// Defaults must stay in sync with the Rust engine constants:
// - DEFAULT_PROGRESS_UPDATE_INTERVAL_MS in ffui_core::settings::types
// - DEFAULT_METRICS_INTERVAL_MS in ffui_core::settings::types
const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 250;
const DEFAULT_METRICS_INTERVAL_MS = 1_000;

const progressUpdateIntervalDraft = ref<string | null>(null);
const metricsIntervalDraft = ref<string | null>(null);

const setProgressUpdateIntervalDraft = (value: string | number) => {
  progressUpdateIntervalDraft.value = String(value);
};

const setMetricsIntervalDraft = (value: string | number) => {
  metricsIntervalDraft.value = String(value);
};

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};

const getProgressUpdateIntervalInputValue = () => {
  if (!props.appSettings) return DEFAULT_PROGRESS_UPDATE_INTERVAL_MS;
  const raw = props.appSettings.progressUpdateIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_PROGRESS_UPDATE_INTERVAL_MS;
};

const getMetricsIntervalInputValue = () => {
  if (!props.appSettings) return DEFAULT_METRICS_INTERVAL_MS;
  const raw = props.appSettings.metricsIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_METRICS_INTERVAL_MS;
};

const commitProgressUpdateIntervalDraft = () => {
  if (!props.appSettings) return;
  const draft = progressUpdateIntervalDraft.value;
  progressUpdateIntervalDraft.value = null;
  if (draft === null) return;

  const trimmed = draft.trim();
  if (trimmed === "") {
    updateSetting("progressUpdateIntervalMs", undefined);
    return;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return;

  const clamped = Math.min(2000, Math.max(50, Math.round(parsed)));
  updateSetting("progressUpdateIntervalMs", clamped);
};

const commitMetricsIntervalDraft = () => {
  if (!props.appSettings) return;
  const draft = metricsIntervalDraft.value;
  metricsIntervalDraft.value = null;
  if (draft === null) return;

  const trimmed = draft.trim();
  if (trimmed === "") {
    updateSetting("metricsIntervalMs", undefined);
    return;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return;

  const clamped = Math.min(5000, Math.max(100, Math.round(parsed)));
  updateSetting("metricsIntervalMs", clamped);
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-refresh-frequency">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.refreshFrequencyTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col flex-1">
      <div class="flex flex-col flex-1 justify-between gap-2">
        <div>
          <div class="flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-foreground">
              {{ t("app.settings.progressUpdateIntervalLabel") }}
            </label>
            <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
              <Input
                :model-value="progressUpdateIntervalDraft ?? String(getProgressUpdateIntervalInputValue())"
                type="number"
                min="50"
                max="2000"
                step="50"
                data-testid="settings-progress-update-interval-ms"
                class="w-20 h-6 text-[10px] font-mono text-center"
                @update:model-value="setProgressUpdateIntervalDraft"
                @blur="commitProgressUpdateIntervalDraft"
                @keydown.enter.prevent="commitProgressUpdateIntervalDraft"
              />
              <span class="text-[10px] text-muted-foreground text-right w-6">ms</span>
            </div>
          </div>
          <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
            {{ t("app.settings.progressUpdateIntervalHelp") }}
          </p>
        </div>

        <div>
          <div class="flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-foreground">
              {{ t("app.settings.metricsIntervalLabel") }}
            </label>
            <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
              <Input
                :model-value="metricsIntervalDraft ?? String(getMetricsIntervalInputValue())"
                type="number"
                min="100"
                max="5000"
                step="100"
                data-testid="settings-metrics-interval-ms"
                class="w-20 h-6 text-[10px] font-mono text-center"
                @update:model-value="setMetricsIntervalDraft"
                @blur="commitMetricsIntervalDraft"
                @keydown.enter.prevent="commitMetricsIntervalDraft"
              />
              <span class="text-[10px] text-muted-foreground text-right w-6">ms</span>
            </div>
          </div>
          <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
            {{ t("app.settings.metricsIntervalHelp") }}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
