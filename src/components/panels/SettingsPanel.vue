<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "vue-i18n";
import { hasTauri, openDevtools } from "@/lib/backend";
import SettingsAppUpdatesSection from "@/components/panels/SettingsAppUpdatesSection.vue";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import SettingsExternalToolsSection from "@/components/panels/SettingsExternalToolsSection.vue";
import SettingsQueuePersistenceSection from "@/components/panels/SettingsQueuePersistenceSection.vue";
import SettingsTaskbarProgressSection from "@/components/panels/SettingsTaskbarProgressSection.vue";
import type {
  AppSettings,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
} from "@/types";
type AppUpdateUiState = {
  configured?: boolean | null;
  autoCheckDefault?: boolean;
  available: boolean;
  checking: boolean;
  installing: boolean;
  availableVersion: string | null;
  currentVersion: string | null;
  lastCheckedAtMs: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
};
const props = withDefaults(
  defineProps<{
  /** Application settings */
  appSettings: AppSettings | null;
  /** External tool statuses */
  toolStatuses: ExternalToolStatus[];
  /** Whether tool statuses have been refreshed at least once this session. */
  toolStatusesFresh?: boolean;
  /** Trigger an async tool status refresh (non-blocking). */
  refreshToolStatuses?: (options?: {
    remoteCheck?: boolean;
    manualRemoteCheck?: boolean;
  }) => Promise<void>;
  /** App updater UI state snapshot. */
  appUpdate?: AppUpdateUiState;
  /** Manually trigger an app update check. */
  checkForAppUpdate?: (options?: { force?: boolean }) => Promise<void>;
  /** Download and install the currently available update. */
  installAppUpdate?: () => Promise<void>;
  /** Whether settings are being saved */
  isSavingSettings: boolean;
  /** Settings save error message */
  settingsSaveError: string | null;
  /** Fetch available candidate binaries for a tool kind. */
  fetchToolCandidates: (kind: ExternalToolKind) => Promise<ExternalToolCandidate[]>;
  }>(),
  {
    toolStatusesFresh: true,
    appUpdate: () => ({
      available: false, checking: false, installing: false,
      availableVersion: null, currentVersion: null, lastCheckedAtMs: null,
      downloadedBytes: 0, totalBytes: null, error: null,
    }),
  },
);

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
  downloadTool: [kind: ExternalToolKind];
}>();

const { t } = useI18n();
// Defaults must stay in sync with the Rust engine constants:
// - DEFAULT_PROGRESS_UPDATE_INTERVAL_MS in ffui_core::settings::types
// - DEFAULT_METRICS_INTERVAL_MS in ffui_core::settings::types
const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 250;
const DEFAULT_METRICS_INTERVAL_MS = 1_000;
// When unset, the engine derives concurrency automatically when maxParallelJobs
// is None or 0. We surface this as an explicit "0 = 自动" default in the UI.
const DEFAULT_MAX_PARALLEL_JOBS_AUTO = 0;

const getMaxParallelJobsInputValue = () => {
  if (!props.appSettings) return DEFAULT_MAX_PARALLEL_JOBS_AUTO;
  const raw = props.appSettings.maxParallelJobs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_MAX_PARALLEL_JOBS_AUTO;
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

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
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
    // Rare legacy / advanced combination: surface as a custom strategy so
    // the user can see it is not one of the three recommended modes.
    return "custom";
  },
  set(mode) {
    if (!props.appSettings) return;
    if (mode === "custom") {
      // Custom mode is derived from the underlying switches; selecting it
      // should not mutate the existing combination.
      return;
    }
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
</script>

<template>
  <section class="max-w-7xl mx-auto px-3 py-2 min-h-full flex flex-col" data-testid="settings-panel">
    <div class="grid gap-2 items-stretch lg:grid-cols-12 flex-1 min-h-0">
      <div class="lg:col-span-8 flex flex-col gap-2 min-h-0">
        <SettingsExternalToolsSection
          :app-settings="appSettings"
          :tool-statuses="toolStatuses"
          :tool-statuses-fresh="toolStatusesFresh"
          :fetch-tool-candidates="fetchToolCandidates"
          :refresh-tool-statuses="refreshToolStatuses"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
          @downloadTool="(kind) => emit('downloadTool', kind)"
        />
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

            <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
              <input
                type="radio"
                name="external-tools-mode"
                class="mt-[2px] w-3 h-3 rounded border-border/50"
                :checked="toolsMode === 'autoManaged'"
                @change="toolsMode = 'autoManaged'"
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
              <input
                type="radio"
                name="external-tools-mode"
                class="mt-[2px] w-3 h-3 rounded border-border/50"
                :checked="toolsMode === 'installOnly'"
                @change="toolsMode = 'installOnly'"
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
              <input
                type="radio"
                name="external-tools-mode"
                class="mt-[2px] w-3 h-3 rounded border-border/50"
                :checked="toolsMode === 'manual'"
                @change="toolsMode = 'manual'"
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

            <div
              v-if="toolsMode === 'custom'"
              data-testid="tools-mode-custom-hint"
              class="mt-0.5 rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-1"
            >
              <p class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
                <span class="font-semibold">
                  {{ t("app.settings.toolModeCustomLabel") }}：
                </span>
                {{ t("app.settings.toolModeCustomDescription") }}
              </p>
            </div>
          </div>

          <div class="pt-1 grid auto-rows-min content-evenly flex-1 min-h-0 divide-y divide-border/40">
            <SettingsQueuePersistenceSection
              :app-settings="appSettings"
              @update:app-settings="(settings) => emit('update:appSettings', settings)"
            />

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

            <div class="py-1">
              <div class="flex items-center justify-between gap-2">
                <label class="text-[11px] font-medium text-foreground">
                  {{ t("app.settings.maxParallelJobsLabel") }}
                </label>
                <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
                  <Input
                    :model-value="getMaxParallelJobsInputValue()"
                    type="number"
                    min="0"
                    max="32"
                    class="w-20 h-6 text-[10px] font-mono text-center"
                    @update:model-value="(v) => updateSetting('maxParallelJobs', Number(v))"
                  />
                  <span class="w-6" aria-hidden="true"></span>
                </div>
              </div>
              <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.maxParallelJobsHelp") }}
              </p>
            </div>

            <div class="py-1">
              <div class="flex items-center justify-between gap-2">
                <label class="text-[11px] font-medium text-foreground">
                  {{ t("app.settings.progressUpdateIntervalLabel") }}
                </label>
                <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
                  <Input
                    :model-value="getProgressUpdateIntervalInputValue()"
                    type="number"
                    min="50"
                    max="2000"
                    step="50"
                    class="w-20 h-6 text-[10px] font-mono text-center"
                    @update:model-value="(v) => updateSetting('progressUpdateIntervalMs', Number(v))"
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
                    :model-value="getMetricsIntervalInputValue()"
                    type="number"
                    min="100"
                    max="5000"
                    step="100"
                    class="w-20 h-6 text-[10px] font-mono text-center"
                    @update:model-value="(v) => updateSetting('metricsIntervalMs', Number(v))"
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
      </div>

      <div class="lg:col-span-4 flex flex-col gap-2 min-h-0">
        <SettingsAppearanceSection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsAppUpdatesSection
          :app-settings="appSettings"
          :app-update="appUpdate"
          :check-for-app-update="checkForAppUpdate"
          :install-app-update="installAppUpdate"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsTaskbarProgressSection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <Card class="border-border/50 bg-card/95 shadow-sm">
          <CardHeader class="py-2 px-3 border-b border-border/30">
            <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              {{ t("app.settings.devtoolsSectionTitle") }}
            </CardTitle>
          </CardHeader>
          <CardContent class="p-2">
            <div class="flex items-center justify-between">
              <p class="text-[10px] text-muted-foreground">
                {{ hasTauri() ? t("app.settings.devtoolsWindowHint") : t("app.openDevtoolsUnavailable") }}
              </p>
              <Button
                variant="outline"
                size="sm"
                class="h-6 px-2 text-[10px]"
                data-testid="settings-open-devtools"
                :disabled="!hasTauri()"
                @click="openDevtools"
              >
                {{ t("app.openDevtools") }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col lg:flex-1 lg:min-h-0">
          <CardHeader class="py-2 px-3 border-b border-border/30">
            <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              {{ t("app.settings.systemInfoTitle") }}
            </CardTitle>
          </CardHeader>
          <CardContent class="p-2 flex flex-col lg:flex-1 lg:min-h-0">
            <div class="grid auto-rows-min content-between flex-1 min-h-0 font-mono text-[9px] text-muted-foreground">
              <div class="flex justify-between">
                <span class="opacity-60">PLATFORM:</span>
                <span>{{ hasTauri() ? 'TAURI' : 'WEB' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="opacity-60">SETTINGS:</span>
                <span class="text-primary">{{ appSettings ? 'LOADED' : 'LOADING...' }}</span>
              </div>
              <div v-if="isSavingSettings || settingsSaveError" class="flex justify-between">
                <span class="opacity-60">STATUS:</span>
                <span :class="settingsSaveError ? 'text-red-500' : 'text-yellow-500'">
                  {{ isSavingSettings ? 'SAVING...' : 'ERROR' }}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    <div v-if="appSettings" class="mt-3 px-2 py-1 bg-muted/30 rounded border border-border/30">
      <p class="text-[9px] font-mono text-muted-foreground text-center">
        <span v-if="isSavingSettings" class="text-yellow-500">● SAVING SETTINGS...</span>
        <span v-else-if="settingsSaveError" class="text-red-500">● {{ settingsSaveError }}</span>
        <span v-else class="text-emerald-500">● {{ t("app.settings.autoSaveHint") }}</span>
      </p>
    </div>

    <div v-if="!appSettings" class="flex items-center justify-center py-12">
      <div class="text-center space-y-2">
        <div class="inline-flex items-center gap-2">
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse animation-delay-200"></div>
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse animation-delay-400"></div>
        </div>
        <p class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {{ t("app.settings.loadingSettings") }}
        </p>
      </div>
    </div>
  </section>
</template>
<style scoped>
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
.animation-delay-200 { animation-delay: 200ms; }
.animation-delay-400 { animation-delay: 400ms; }
</style>
