<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import { hasTauri, openDevtools } from "@/lib/backend";
import type { AppSettings, ExternalToolKind, ExternalToolStatus } from "@/types";

const props = defineProps<{
  /** Application settings */
  appSettings: AppSettings | null;
  /** External tool statuses */
  toolStatuses: ExternalToolStatus[];
  /** Whether settings are being saved */
  isSavingSettings: boolean;
  /** Settings save error message */
  settingsSaveError: string | null;
}>();

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

const getToolDisplayName = (kind: ExternalToolKind): string => {
  if (kind === "ffmpeg") return "FFmpeg";
  if (kind === "ffprobe") return "FFprobe";
  if (kind === "avifenc") return "avifenc";
  return kind;
};

const getToolCustomPath = (kind: ExternalToolKind): string => {
  if (!props.appSettings) return "";
  const tools = props.appSettings.tools;
  if (kind === "ffmpeg") return tools.ffmpegPath ?? "";
  if (kind === "ffprobe") return tools.ffprobePath ?? "";
  if (kind === "avifenc") return tools.avifencPath ?? "";
  return "";
};

const setToolCustomPath = (kind: ExternalToolKind, value: string | number) => {
  if (!props.appSettings) return;
  const settings = { ...props.appSettings };
  const tools = { ...settings.tools };
  const normalized = String(value ?? "").trim();
  if (kind === "ffmpeg") {
    tools.ffmpegPath = normalized || undefined;
  } else if (kind === "ffprobe") {
    tools.ffprobePath = normalized || undefined;
  } else if (kind === "avifenc") {
    tools.avifencPath = normalized || undefined;
  }
  settings.tools = tools;
  emit("update:appSettings", settings);
};

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};

const updateToolsSetting = <K extends keyof AppSettings["tools"]>(key: K, value: AppSettings["tools"][K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", {
    ...props.appSettings,
    tools: { ...props.appSettings.tools, [key]: value },
  });
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Fallback method
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

const formatBytes = (value?: number): string => {
  if (value == null || !Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = value;
  let unitIndex = 0;
  while (v >= 1024 && unitIndex < units.length - 1) {
    v /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = unitIndex === 0 ? 0 : 1;
  return `${v.toFixed(fractionDigits)} ${units[unitIndex]}`;
};

const formatSpeed = (bytesPerSecond?: number): string => {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond)) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
};
</script>

<template>
  <section class="max-w-7xl mx-auto px-3 py-2">
    <!-- Compact grid layout for high information density -->
    <div class="grid gap-2 xl:grid-cols-3 lg:grid-cols-2">

      <!-- External Tools Section -->
      <Card class="xl:col-span-2 border-border/50 bg-card/95 shadow-sm">
        <CardHeader class="py-2 px-3 border-b border-border/30">
          <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {{ t("app.settings.externalToolsTitle") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="p-2 space-y-1">
          <div
            v-for="tool in toolStatuses"
            :key="tool.kind"
            class="p-2 rounded border border-border/20 bg-background/50 hover:bg-accent/5 transition-colors"
          >
            <!-- Tool header with status -->
            <div class="flex items-center justify-between mb-1.5 gap-2 min-w-0">
              <div class="flex items-center gap-2 shrink-0">
                <code class="text-[11px] font-mono font-semibold">{{ getToolDisplayName(tool.kind) }}</code>
                <span
                  class="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono uppercase tracking-wider whitespace-nowrap"
                  :class="
                    tool.resolvedPath
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                  "
                >
                  {{ tool.resolvedPath ? t("app.settings.toolStatus.ready") : t("app.settings.toolStatus.missing") }}
                </span>
              </div>
              <span
                v-if="tool.version"
                class="ml-2 text-[10px] text-muted-foreground font-mono opacity-70 truncate max-w-[55%] text-right"
              >
                {{ tool.version }}
              </span>
            </div>

            <!-- Tool path display -->
            <div v-if="tool.resolvedPath" class="mb-1.5">
              <div class="flex items-center gap-1 group">
                <span class="text-[9px] text-muted-foreground uppercase tracking-wider">PATH:</span>
                <code class="flex-1 text-[10px] font-mono text-muted-foreground truncate">
                  {{ tool.resolvedPath }}
                </code>
                <button
                  class="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent rounded transition-all"
                  @click="copyToClipboard(tool.resolvedPath)"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Custom path input -->
            <div v-if="appSettings" class="flex items-center gap-1.5">
              <span class="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">CUSTOM:</span>
              <Input
                :model-value="getToolCustomPath(tool.kind)"
                :placeholder="t('app.settings.customToolPathPlaceholder')"
                class="h-6 text-[10px] font-mono bg-background/50 border-border/30 px-2"
                @update:model-value="(value) => setToolCustomPath(tool.kind, value)"
              />
            </div>

            <!-- Update available / manual download actions -->
            <div class="mt-1 flex items-center justify-between text-[9px]">
              <span v-if="tool.updateAvailable" class="text-amber-600">
                {{ t("app.settings.updateAvailableHint", { version: tool.remoteVersion ?? tool.version ?? "?" }) }}
              </span>
              <Button
                v-if="!tool.downloadInProgress && (tool.updateAvailable || !tool.resolvedPath)"
                variant="outline"
                size="sm"
                class="h-5 px-2 text-[9px]"
                @click="emit('downloadTool', tool.kind)"
              >
                {{ tool.updateAvailable ? "更新" : "下载" }}
              </Button>
            </div>

            <!-- Download progress -->
            <div v-if="tool.downloadInProgress" class="mt-1.5 space-y-0.5">
              <div class="flex items-center justify-between text-[9px]">
                <span class="text-muted-foreground uppercase tracking-wider">
                  {{ t("app.settings.downloadStatusLabel") }}
                </span>
                <span v-if="tool.downloadProgress != null" class="font-mono text-primary">
                  {{ tool.downloadProgress.toFixed(1) }}%
                </span>
              </div>
              <div class="flex items-center justify-between text-[9px] text-muted-foreground">
                <span v-if="tool.downloadedBytes != null">
                  {{ formatBytes(tool.downloadedBytes) }}
                  <span v-if="tool.totalBytes != null">
                    / {{ formatBytes(tool.totalBytes) }}
                  </span>
                </span>
                <span v-if="tool.bytesPerSecond != null" class="font-mono">
                  {{ formatSpeed(tool.bytesPerSecond) }}
                </span>
              </div>
              <div class="h-1 bg-muted/50 rounded-full overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-300"
                  :class="tool.downloadProgress == null ? 'animate-pulse w-1/3' : ''"
                  :style="tool.downloadProgress != null ? { width: `${tool.downloadProgress}%` } : {}"
                />
              </div>
              <p class="text-[9px] text-muted-foreground mt-0.5 leading-snug">
                {{ tool.lastDownloadMessage || t("app.settings.downloadInProgress") }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Core Settings Section -->
      <Card class="border-border/50 bg-card/95 shadow-sm">
        <CardHeader class="py-2 px-3 border-b border-border/30">
          <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {{ t("app.settings.autoDownloadSectionTitle") }}
          </CardTitle>
        </CardHeader>
        <CardContent v-if="appSettings" class="p-2 space-y-2">
          <!-- Auto update external tools switch -->
          <label class="flex items-center gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <input
              :checked="appSettings.tools.autoUpdate"
              type="checkbox"
              class="w-3 h-3 rounded border-border/50"
              @change="updateToolsSetting('autoUpdate', ($event.target as HTMLInputElement).checked)"
            />
            <span class="text-[10px] select-none">
              {{ t("app.settings.autoUpdateExternalToolsLabel") }}
            </span>
          </label>

          <!-- Numeric settings -->
          <div class="space-y-1.5 pt-1">
            <div class="grid grid-cols-[1fr,auto] items-center gap-2">
              <label class="text-[10px] text-muted-foreground">{{ t("app.settings.previewCaptureLabel") }}</label>
              <div class="flex items-center gap-1">
                <Input
                  :model-value="appSettings.previewCapturePercent"
                  type="number"
                  min="0"
                  max="100"
                  class="w-16 h-6 text-[10px] font-mono text-center"
                  @update:model-value="(v) => updateSetting('previewCapturePercent', Number(v))"
                />
                <span class="text-[10px] text-muted-foreground">%</span>
              </div>
            </div>

            <div class="grid grid-cols-[1fr,auto] items-center gap-2">
              <label class="text-[10px] text-muted-foreground">{{ t("app.settings.maxParallelJobsLabel") }}</label>
              <Input
                :model-value="getMaxParallelJobsInputValue()"
                type="number"
                min="0"
                max="32"
                class="w-16 h-6 text-[10px] font-mono text-center"
                @update:model-value="(v) => updateSetting('maxParallelJobs', Number(v))"
              />
            </div>

            <div class="grid grid-cols-[1fr,auto] items-center gap-2">
              <label class="text-[10px] text-muted-foreground">{{ t("app.settings.progressUpdateIntervalLabel") }}</label>
              <div class="flex items-center gap-1">
                <Input
                  :model-value="getProgressUpdateIntervalInputValue()"
                  type="number"
                  min="50"
                  max="2000"
                  step="50"
                  class="w-20 h-6 text-[10px] font-mono text-center"
                  @update:model-value="(v) => updateSetting('progressUpdateIntervalMs', Number(v))"
                />
                <span class="text-[10px] text-muted-foreground">ms</span>
              </div>
            </div>

            <div class="grid grid-cols-[1fr,auto] items-center gap-2">
              <label class="text-[10px] text-muted-foreground">
                {{ t("app.settings.metricsIntervalLabel") }}
              </label>
              <div class="flex items-center gap-1">
                <Input
                  :model-value="getMetricsIntervalInputValue()"
                  type="number"
                  min="100"
                  max="5000"
                  step="100"
                  class="w-20 h-6 text-[10px] font-mono text-center"
                  @update:model-value="(v) => updateSetting('metricsIntervalMs', Number(v))"
                />
                <span class="text-[10px] text-muted-foreground">ms</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Interface Settings -->
      <Card class="border-border/50 bg-card/95 shadow-sm">
        <CardHeader class="py-2 px-3 border-b border-border/30">
          <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {{ t("app.taskbarProgressModeLabel") }}
          </CardTitle>
        </CardHeader>
        <CardContent v-if="appSettings" class="p-2">
          <Select
            :model-value="appSettings.taskbarProgressMode"
            @update:model-value="(v) => updateSetting('taskbarProgressMode', v as AppSettings['taskbarProgressMode'])"
          >
            <SelectTrigger class="h-7 text-[10px] bg-background/50 border-border/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bySize" class="text-[10px]">
                {{ t("app.taskbarProgressModes.bySize") }}
              </SelectItem>
              <SelectItem value="byDuration" class="text-[10px]">
                {{ t("app.taskbarProgressModes.byDuration") }}
              </SelectItem>
              <SelectItem value="byEstimatedTime" class="text-[10px]">
                {{ t("app.taskbarProgressModes.byEstimatedTime") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">
            {{ t("app.taskbarProgressModeHelp") }}
          </p>
        </CardContent>
      </Card>

      <!-- Developer Tools -->
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

      <!-- System Info Panel (optional - adds technical flair) -->
      <Card class="border-border/50 bg-card/95 shadow-sm lg:col-span-2 xl:col-span-1">
        <CardHeader class="py-2 px-3 border-b border-border/30">
          <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            SYSTEM INFO
          </CardTitle>
        </CardHeader>
        <CardContent class="p-2">
          <div class="space-y-1 font-mono text-[9px] text-muted-foreground">
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

    <!-- Status bar at bottom -->
    <div v-if="appSettings" class="mt-3 px-2 py-1 bg-muted/30 rounded border border-border/30">
      <p class="text-[9px] font-mono text-muted-foreground text-center">
        <span v-if="isSavingSettings" class="text-yellow-500">● SAVING SETTINGS...</span>
        <span v-else-if="settingsSaveError" class="text-red-500">● {{ settingsSaveError }}</span>
        <span v-else class="text-emerald-500">● {{ t("app.settings.autoSaveHint") }}</span>
      </p>
    </div>

    <!-- Loading state -->
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
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.animation-delay-200 {
  animation-delay: 200ms;
}

.animation-delay-400 {
  animation-delay: 400ms;
}
</style>
