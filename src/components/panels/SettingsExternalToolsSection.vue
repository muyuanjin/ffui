<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "vue-i18n";
import type { AppSettings, ExternalToolKind, ExternalToolStatus } from "@/types";

const props = defineProps<{
  appSettings: AppSettings | null;
  toolStatuses: ExternalToolStatus[];
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
  downloadTool: [kind: ExternalToolKind];
}>();

const { t } = useI18n();

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
  // Persist the updated path in app settings so the UI reflects changes.
  emit("update:appSettings", settings);
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Fallback for environments where Clipboard API is not available.
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
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
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
          <span v-if="tool.updateAvailable && !tool.lastDownloadError" class="text-amber-600">
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

        <!-- Download error message -->
        <p
          v-if="tool.lastDownloadError"
          class="mt-1 text-[9px] text-red-600 dark:text-red-400 leading-snug"
        >
          {{ tool.lastDownloadError }}
        </p>

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
            <span v-if="tool.downloadedBytes != null && tool.downloadedBytes > 0">
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
              :class="tool.downloadProgress == null ? 'animate-pulse w-full' : ''"
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
</template>
