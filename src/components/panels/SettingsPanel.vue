<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  refreshToolStatuses: [];
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const getToolDisplayName = (kind: ExternalToolKind): string => {
  if (kind === "ffmpeg") return "FFmpeg";
  if (kind === "ffprobe") return "ffprobe";
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
  if (typeof navigator === "undefined" || typeof document === "undefined") return;

  try {
    if ("clipboard" in navigator && (navigator as any).clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch (error) {
    console.error("navigator.clipboard.writeText failed", error);
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (error) {
    console.error("Fallback copy to clipboard failed", error);
  }
};
</script>

<template>
  <section class="max-w-5xl mx-auto pt-4 pb-12 text-sm text-foreground">
    <div class="space-y-8">
      <div class="grid gap-6 md:grid-cols-2 items-start">
        <Card class="border-border/80 shadow-sm">
          <CardHeader class="pb-3 flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle class="text-sm text-foreground">
                {{ t("app.settings.externalToolsTitle") }}
              </CardTitle>
              <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                {{ t("app.settings.externalToolsDescription") }}
              </CardDescription>
            </div>
            <Button
              v-if="hasTauri()"
              size="sm"
              variant="outline"
              class="h-7 px-3 text-[11px]"
              @click="emit('refreshToolStatuses')"
            >
              {{ t("app.settings.refreshToolsStatus") }}
            </Button>
          </CardHeader>
          <CardContent class="space-y-3 text-xs">
            <div
              v-for="tool in toolStatuses"
              :key="tool.kind"
              class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 space-y-2"
            >
              <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-[11px] font-semibold text-foreground">
                    {{ getToolDisplayName(tool.kind) }}
                  </span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] border"
                    :class="
                      tool.resolvedPath
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40'
                        : 'bg-destructive/10 text-destructive border-destructive/40'
                    "
                  >
                    {{
                      tool.resolvedPath
                        ? t("app.settings.toolStatus.ready")
                        : t("app.settings.toolStatus.missing")
                    }}
                  </span>
                </div>
                <span
                  v-if="tool.version"
                  class="text-[10px] text-muted-foreground font-mono text-left sm:text-right sm:max-w-[240px] truncate"
                  :title="tool.version"
                >
                  {{ tool.version }}
                </span>
              </div>

              <div class="space-y-1">
                <label class="block text-[10px] text-muted-foreground">
                  {{ t("app.settings.currentToolPathLabel") }}
                </label>
                <div
                  v-if="tool.resolvedPath"
                  class="flex items-center gap-2"
                >
                  <p
                    class="flex-1 text-[11px] font-mono break-all text-foreground/90 select-text"
                  >
                    {{ tool.resolvedPath }}
                  </p>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    class="h-6 w-6 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                    @click="copyToClipboard(tool.resolvedPath)"
                  >
                    ⧉
                  </Button>
                </div>
                <p v-else class="text-[11px] text-destructive">
                  {{ t("app.settings.toolNotFoundHelp") }}
                </p>
              </div>

              <div v-if="appSettings" class="space-y-1">
                <label class="block text-[10px] text-muted-foreground">
                  {{ t("app.settings.customToolPathLabel") }}
                </label>
                <Input
                  :model-value="getToolCustomPath(tool.kind)"
                  class="h-8 text-xs"
                  :placeholder="t('app.settings.customToolPathPlaceholder') as string"
                  @update:model-value="(value) => setToolCustomPath(tool.kind, value)"
                />
              </div>

              <div
                v-if="
                  tool.downloadInProgress ||
                  tool.lastDownloadError ||
                  tool.lastDownloadMessage
                "
                class="space-y-1"
              >
                <label class="block text-[10px] text-muted-foreground">
                  {{ t("app.settings.downloadStatusLabel") }}
                </label>
                <div v-if="tool.downloadInProgress" class="space-y-1">
                  <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      :class="tool.downloadProgress == null ? 'animate-pulse' : ''"
                      :style="
                        tool.downloadProgress != null
                          ? { width: `${tool.downloadProgress}%` }
                          : { width: '40%' }
                      "
                    />
                  </div>
                  <p class="text-[10px] text-muted-foreground">
                    {{
                      tool.lastDownloadMessage ||
                      (t("app.settings.downloadInProgress") as string)
                    }}
                  </p>
                </div>
                <p
                  v-else-if="tool.lastDownloadError"
                  class="text-[10px] text-destructive"
                >
                  {{ tool.lastDownloadError }}
                </p>
                <p
                  v-else-if="tool.lastDownloadMessage"
                  class="text-[10px] text-muted-foreground"
                >
                  {{ tool.lastDownloadMessage }}
                </p>
              </div>

              <p
                v-if="tool.updateAvailable"
                class="text-[10px] text-amber-400"
              >
                {{ t("app.settings.updateAvailableHint") }}
              </p>
            </div>

            <p class="text-[10px] text-muted-foreground">
              {{ t("app.settings.customToolPathFooter") }}
            </p>
          </CardContent>
        </Card>

        <div v-if="appSettings" class="space-y-4">
          <Card class="border-border/80 shadow-sm">
            <CardHeader class="pb-3">
              <CardTitle class="text-sm text-foreground">
                {{ t("app.settings.autoDownloadSectionTitle") }}
              </CardTitle>
              <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                {{ t("app.settings.autoDownloadSectionDescription") }}
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4 text-xs">
              <div class="space-y-2">
                <h4 class="text-[11px] font-semibold text-foreground">
                  {{ t("app.settings.downloadStrategyLabel") }}
                </h4>
                <div class="flex flex-wrap items-center gap-3">
                  <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                    <input
                      :checked="appSettings.tools.autoDownload"
                      type="checkbox"
                      class="h-3 w-3"
                      @change="updateToolsSetting('autoDownload', ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t("app.settings.allowAutoDownloadLabel") }}</span>
                  </label>
                  <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                    <input
                      :checked="appSettings.tools.autoUpdate"
                      type="checkbox"
                      class="h-3 w-3"
                      @change="updateToolsSetting('autoUpdate', ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t("app.settings.allowAutoUpdateLabel") }}</span>
                  </label>
                </div>
              </div>

              <div class="grid gap-3">
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    {{ t("app.settings.previewCaptureLabel") }}
                  </label>
                  <div class="flex items-center gap-2">
                    <Input
                      :model-value="appSettings.previewCapturePercent"
                      type="number"
                      min="0"
                      max="100"
                      class="h-8 w-24 text-xs"
                      @update:model-value="(v) => updateSetting('previewCapturePercent', Number(v))"
                    />
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("app.settings.previewCaptureHelp") }}
                    </span>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    {{ t("app.settings.maxParallelJobsLabel") }}
                  </label>
                  <div class="flex items-center gap-2">
                    <Input
                      :model-value="appSettings.maxParallelJobs"
                      type="number"
                      min="0"
                      max="32"
                      class="h-8 w-24 text-xs"
                      @update:model-value="(v) => updateSetting('maxParallelJobs', Number(v))"
                    />
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("app.settings.maxParallelJobsHelp") }}
                    </span>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    {{ t("app.settings.progressUpdateIntervalLabel") }}
                  </label>
                  <div class="flex items-center gap-2">
                    <Input
                      :model-value="appSettings.progressUpdateIntervalMs"
                      type="number"
                      min="50"
                      max="2000"
                      class="h-8 w-24 text-xs"
                      @update:model-value="(v) => updateSetting('progressUpdateIntervalMs', Number(v))"
                    />
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("app.settings.progressUpdateIntervalHelp") }}
                    </span>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    {{ t("app.taskbarProgressModeLabel") }}
                  </label>
                  <div class="flex items-center gap-2">
                    <Select
                      :model-value="appSettings.taskbarProgressMode"
                      @update:model-value="(v) => updateSetting('taskbarProgressMode', v as AppSettings['taskbarProgressMode'])"
                    >
                      <SelectTrigger class="h-8 min-w-[180px] text-xs">
                        <SelectValue :placeholder="t('app.taskbarProgressModeLabel')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bySize">
                          {{ t("app.taskbarProgressModes.bySize") }}
                        </SelectItem>
                        <SelectItem value="byDuration">
                          {{ t("app.taskbarProgressModes.byDuration") }}
                        </SelectItem>
                        <SelectItem value="byEstimatedTime">
                          {{ t("app.taskbarProgressModes.byEstimatedTime") }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("app.taskbarProgressModeHelp") }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="text-[10px] text-muted-foreground">
                <span v-if="isSavingSettings">
                  {{ t("app.settings.savingSettings") }}
                </span>
                <span v-else-if="settingsSaveError" class="text-destructive">
                  {{ settingsSaveError }}
                </span>
                <span v-else>
                  {{ t("app.settings.autoSaveHint") }}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card class="border-border/80 shadow-sm">
            <CardHeader class="pb-3 flex items-center justify-between gap-2">
              <div>
                <CardTitle class="text-sm text-foreground">
                  {{ t("app.settings.devtoolsSectionTitle") }}
                </CardTitle>
                <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                  {{ t("app.settings.devtoolsSectionDescription") }}
                </CardDescription>
              </div>
              <Button
                data-testid="settings-open-devtools"
                size="sm"
                variant="outline"
                class="h-7 px-3 text-[11px]"
                :disabled="!hasTauri()"
                @click="openDevtools"
              >
                {{ t("app.openDevtools") }}
              </Button>
            </CardHeader>
            <CardContent class="space-y-2 text-xs">
              <p v-if="!hasTauri()" class="text-[11px] text-muted-foreground">
                {{ t("app.openDevtoolsUnavailable") }}
              </p>
              <p v-else class="text-[11px] text-muted-foreground">
                {{ t("app.settings.devtoolsWindowHint") }}
              </p>
            </CardContent>
          </Card>
        </div>

        <div v-else class="text-xs text-muted-foreground">
          {{ t("app.settings.loadingSettings") }}
        </div>
      </div>
    </div>
  </section>
</template>
