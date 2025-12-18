<script setup lang="ts">
import { computed, ref } from "vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "vue-i18n";
import SettingsQueuePersistenceSection from "@/components/panels/SettingsQueuePersistenceSection.vue";
import SettingsNetworkProxySection from "@/components/panels/settings-engine/SettingsNetworkProxySection.vue";
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
const DEFAULT_MAX_PARALLEL_JOBS = 2;
const DEFAULT_MAX_PARALLEL_CPU_JOBS = 2;
const DEFAULT_MAX_PARALLEL_HW_JOBS = 1;

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

const getMaxParallelJobsInputValue = () => {
  if (!props.appSettings) return DEFAULT_MAX_PARALLEL_JOBS;
  const raw = props.appSettings.maxParallelJobs;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MAX_PARALLEL_JOBS;
};

const getMaxParallelCpuJobsInputValue = () => {
  if (!props.appSettings) return DEFAULT_MAX_PARALLEL_CPU_JOBS;
  const raw = props.appSettings.maxParallelCpuJobs;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MAX_PARALLEL_CPU_JOBS;
};

const getMaxParallelHwJobsInputValue = () => {
  if (!props.appSettings) return DEFAULT_MAX_PARALLEL_HW_JOBS;
  const raw = props.appSettings.maxParallelHwJobs;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MAX_PARALLEL_HW_JOBS;
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

type ParallelismMode = "unified" | "split";
const parallelismMode = computed<ParallelismMode>({
  get() {
    const raw = props.appSettings?.parallelismMode;
    return raw === "split" ? "split" : "unified";
  },
  set(mode) {
    if (!props.appSettings) return;
    emit("update:appSettings", {
      ...props.appSettings,
      parallelismMode: mode === "split" ? "split" : undefined,
    });
  },
});

const getSplitTotalConcurrency = () => {
  return getMaxParallelCpuJobsInputValue() + getMaxParallelHwJobsInputValue();
};

type ExternalToolsMode = "autoManaged" | "installOnly" | "manual" | "custom";
const toolsMode = computed<ExternalToolsMode>({
  get() {
    const tools = props.appSettings?.tools;
    if (!tools) return "autoManaged";
    const { autoDownload, autoUpdate } = tools;
    if (autoDownload && autoUpdate) return "autoManaged";
    if (autoDownload && !autoUpdate) return "installOnly";
    if (!autoDownload && !autoUpdate) return "manual";
    return "custom";
  },
  set(mode) {
    if (!props.appSettings) return;
    if (mode === "custom") return;
    const next: AppSettings = {
      ...props.appSettings,
      tools: { ...props.appSettings.tools },
    };
    if (mode === "autoManaged") {
      next.tools.autoDownload = true;
      next.tools.autoUpdate = true;
    } else if (mode === "installOnly") {
      next.tools.autoDownload = true;
      next.tools.autoUpdate = false;
    } else if (mode === "manual") {
      next.tools.autoDownload = false;
      next.tools.autoUpdate = false;
    }
    emit("update:appSettings", next);
  },
});

const onUpdateSettings = (settings: AppSettings) => {
  emit("update:appSettings", settings);
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col lg:flex-1 lg:min-h-0">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.autoDownloadSectionTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col gap-2 lg:flex-1 lg:min-h-0">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.autoDownloadSectionDescription") }}
      </p>

      <div class="space-y-1">
        <p class="text-[9px] text-muted-foreground uppercase tracking-wider">
          {{ t("app.settings.downloadStrategyLabel") }}
        </p>

        <RadioGroup class="grid gap-0.5" :model-value="toolsMode" @update:model-value="(v) => (toolsMode = v as any)">
          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-auto-managed"
              data-testid="external-tools-mode-auto-managed"
              value="autoManaged"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] select-none">
                  {{ t("app.settings.toolModeAutoManagedLabel") }}
                </span>
                <span
                  class="inline-flex items-center px-1 py-[1px] rounded-full text-[8px] font-medium bg-primary/10 text-primary border border-primary/30"
                >
                  {{ t("app.settings.toolModeRecommendedBadge") }}
                </span>
              </div>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeAutoManagedDescription") }}
              </p>
            </div>
          </label>

          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-install-only"
              data-testid="external-tools-mode-install-only"
              value="installOnly"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <span class="text-[10px] select-none">
                {{ t("app.settings.toolModeInstallOnlyLabel") }}
              </span>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeInstallOnlyDescription") }}
              </p>
            </div>
          </label>

          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-manual"
              data-testid="external-tools-mode-manual"
              value="manual"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <span class="text-[10px] select-none">
                {{ t("app.settings.toolModeManualLabel") }}
              </span>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeManualDescription") }}
              </p>
            </div>
          </label>
        </RadioGroup>

        <div
          v-if="toolsMode === 'custom'"
          data-testid="tools-mode-custom-hint"
          class="mt-0.5 rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-1"
        >
          <p class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
            <span class="font-semibold"> {{ t("app.settings.toolModeCustomLabel") }}： </span>
            {{ t("app.settings.toolModeCustomDescription") }}
          </p>
        </div>
      </div>

      <div class="pt-1 grid auto-rows-min content-evenly flex-1 min-h-0 divide-y divide-border/40">
        <SettingsQueuePersistenceSection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsNetworkProxySection :app-settings="appSettings" @update:app-settings="onUpdateSettings" />

        <div class="py-1">
          <div class="flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-foreground">
              {{ t("app.settings.previewCaptureLabel") }}
            </label>
            <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
              <Input
                :model-value="appSettings.previewCapturePercent"
                type="number"
                min="0"
                max="100"
                data-testid="settings-preview-capture-percent"
                class="w-20 h-6 text-[10px] font-mono text-center"
                @update:model-value="(v) => updateSetting('previewCapturePercent', Number(v))"
              />
              <span class="text-[10px] text-muted-foreground text-right w-6">%</span>
            </div>
          </div>
          <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
            {{ t("app.settings.previewCaptureHelp") }}
          </p>
        </div>

        <div class="py-1 space-y-1.5" data-testid="settings-parallelism-group">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <label class="text-[11px] font-medium text-foreground">
                  {{ t("app.settings.parallelismModeLabel") }}
                </label>
                <TooltipProvider :delay-duration="120">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        class="w-4 h-4 p-0 rounded border border-border/40 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/5"
                        aria-label="Parallelism help"
                        data-testid="settings-parallelism-help"
                      >
                        ?
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" :side-offset="6" class="max-w-[320px] text-[10px] leading-snug">
                      {{ t("app.settings.parallelismModeTooltip") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.parallelismModeHelp") }}
              </p>
            </div>

            <Tabs v-model="parallelismMode">
              <TabsList class="h-6 bg-background/50 border border-border/30 p-0.5">
                <TabsTrigger
                  value="unified"
                  data-testid="settings-parallelism-mode-unified"
                  class="h-5 px-2 text-[10px] leading-none"
                >
                  {{ t("app.settings.parallelismModeUnifiedOption") }}
                </TabsTrigger>
                <TabsTrigger
                  value="split"
                  data-testid="settings-parallelism-mode-split"
                  class="h-5 px-2 text-[10px] leading-none"
                >
                  {{ t("app.settings.parallelismModeSplitOption") }}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div class="ml-1 pl-2 border-l border-border/40 space-y-1.5">
            <div v-if="parallelismMode === 'unified'" class="space-y-0.5">
              <div class="flex items-center justify-between gap-2">
                <label class="text-[11px] font-medium text-foreground">
                  {{ t("app.settings.maxParallelJobsLabel") }}
                </label>
                <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
                  <Input
                    :model-value="getMaxParallelJobsInputValue()"
                    type="number"
                    min="1"
                    max="32"
                    data-testid="settings-max-parallel-jobs"
                    class="w-20 h-6 text-[10px] font-mono text-center"
                    @update:model-value="(v) => updateSetting('maxParallelJobs', Math.max(1, Number(v)))"
                  />
                  <span class="w-6" aria-hidden="true"></span>
                </div>
              </div>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.maxParallelJobsHelp") }}
              </p>
            </div>

            <template v-else>
              <div class="space-y-0.5">
                <div class="flex items-center justify-between gap-2">
                  <label class="text-[11px] font-medium text-foreground">
                    {{ t("app.settings.maxParallelCpuJobsLabel") }}
                  </label>
                  <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
                    <Input
                      :model-value="getMaxParallelCpuJobsInputValue()"
                      type="number"
                      min="1"
                      max="32"
                      data-testid="settings-max-parallel-cpu-jobs"
                      class="w-20 h-6 text-[10px] font-mono text-center"
                      @update:model-value="(v) => updateSetting('maxParallelCpuJobs', Math.max(1, Number(v)))"
                    />
                    <span class="w-6" aria-hidden="true"></span>
                  </div>
                </div>
                <p class="text-[9px] text-muted-foreground leading-snug">
                  {{ t("app.settings.maxParallelCpuJobsHelp") }}
                </p>
              </div>

              <div class="space-y-0.5">
                <div class="flex items-center justify-between gap-2">
                  <label class="text-[11px] font-medium text-foreground">
                    {{ t("app.settings.maxParallelHwJobsLabel") }}
                  </label>
                  <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
                    <Input
                      :model-value="getMaxParallelHwJobsInputValue()"
                      type="number"
                      min="1"
                      max="32"
                      data-testid="settings-max-parallel-hw-jobs"
                      class="w-20 h-6 text-[10px] font-mono text-center"
                      @update:model-value="(v) => updateSetting('maxParallelHwJobs', Math.max(1, Number(v)))"
                    />
                    <span class="w-6" aria-hidden="true"></span>
                  </div>
                </div>
                <p class="text-[9px] text-muted-foreground leading-snug">
                  {{ t("app.settings.maxParallelHwJobsHelp") }}
                </p>
              </div>

              <p class="text-[9px] text-muted-foreground font-mono" data-testid="settings-parallelism-summary">
                {{
                  t("app.settings.parallelismModeSplitSummary", {
                    cpu: getMaxParallelCpuJobsInputValue(),
                    hw: getMaxParallelHwJobsInputValue(),
                    total: getSplitTotalConcurrency(),
                  })
                }}
              </p>
            </template>
          </div>
        </div>

        <div class="py-1">
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

        <div class="py-1">
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
