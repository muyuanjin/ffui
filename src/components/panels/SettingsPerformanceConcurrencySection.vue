<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

// Defaults must stay in sync with the Rust engine constants:
// - DEFAULT_MAX_PARALLEL_JOBS in ffui_core::settings::types
// - DEFAULT_MAX_PARALLEL_CPU_JOBS in ffui_core::settings::types
// - DEFAULT_MAX_PARALLEL_HW_JOBS in ffui_core::settings::types
const DEFAULT_MAX_PARALLEL_JOBS = 2;
const DEFAULT_MAX_PARALLEL_CPU_JOBS = 2;
const DEFAULT_MAX_PARALLEL_HW_JOBS = 1;

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
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-performance">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.performanceConcurrencyTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col flex-1">
      <div class="flex flex-col gap-2 flex-1" data-testid="settings-parallelism-group">
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

        <div class="ml-1 pl-2 border-l border-border/40 flex flex-col flex-1">
          <div
            v-if="parallelismMode === 'unified'"
            class="grid auto-rows-min content-between gap-1 flex-1"
            data-testid="settings-parallelism-unified"
          >
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

          <div v-else class="grid auto-rows-min content-between gap-1 flex-1" data-testid="settings-parallelism-split">
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

            <p class="text-[9px] text-muted-foreground font-mono" data-testid="settings-parallelism-summary">
              {{
                t("app.settings.parallelismModeSplitSummary", {
                  cpu: getMaxParallelCpuJobsInputValue(),
                  hw: getMaxParallelHwJobsInputValue(),
                  total: getSplitTotalConcurrency(),
                })
              }}
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
