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
                外部工具
              </CardTitle>
              <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                管理 ffmpeg / ffprobe / avifenc 的可用性、自定义路径以及自动下载状态。
              </CardDescription>
            </div>
            <Button
              v-if="hasTauri()"
              size="sm"
              variant="outline"
              class="h-7 px-3 text-[11px]"
              @click="emit('refreshToolStatuses')"
            >
              刷新状态
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
                    {{ tool.resolvedPath ? "已就绪" : "未找到" }}
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
                  当前使用路径
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
                  未找到可执行文件，将在需要时尝试自动下载（如果已启用）。
                </p>
              </div>

              <div v-if="appSettings" class="space-y-1">
                <label class="block text-[10px] text-muted-foreground">
                  自定义路径（优先使用）
                </label>
                <Input
                  :model-value="getToolCustomPath(tool.kind)"
                  class="h-8 text-xs"
                  placeholder="留空表示从 PATH 或自动下载目录查找"
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
                  下载 / 更新状态
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
                    {{ tool.lastDownloadMessage || "正在下载，请稍候..." }}
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
                检测到可用更新，将在需要时尝试自动下载该工具。
              </p>
            </div>

            <p class="text-[10px] text-muted-foreground">
              当设置了自定义路径时优先使用自定义路径，否则从自动下载的
              <code class="font-mono">tools</code> 目录或系统 PATH 查找。
            </p>
          </CardContent>
        </Card>

        <div v-if="appSettings" class="space-y-4">
          <Card class="border-border/80 shadow-sm">
            <CardHeader class="pb-3">
              <CardTitle class="text-sm text-foreground">
                自动下载与全局参数
              </CardTitle>
              <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                控制外部工具的自动下载/更新策略，以及预览截帧和并行任务上限。
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4 text-xs">
              <div class="space-y-2">
                <h4 class="text-[11px] font-semibold text-foreground">
                  下载 / 更新策略
                </h4>
                <div class="flex flex-wrap items-center gap-3">
                  <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                    <input
                      :checked="appSettings.tools.autoDownload"
                      type="checkbox"
                      class="h-3 w-3"
                      @change="updateToolsSetting('autoDownload', ($event.target as HTMLInputElement).checked)"
                    />
                    <span>允许自动下载（推荐）</span>
                  </label>
                  <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                    <input
                      :checked="appSettings.tools.autoUpdate"
                      type="checkbox"
                      class="h-3 w-3"
                      @change="updateToolsSetting('autoUpdate', ($event.target as HTMLInputElement).checked)"
                    />
                    <span>允许自动更新</span>
                  </label>
                </div>
              </div>

              <div class="grid gap-3">
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    预览截帧位置（%）
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
                      相对于视频总时长的百分比，默认 25。
                    </span>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    最大并行转码任务数
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
                      0 表示自动（约为 CPU 逻辑核数的一半），&gt; 0 时将上限固定为该值。
                    </span>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] text-muted-foreground">
                    进度刷新节奏（毫秒）
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
                      控制后端 ffmpeg 汇报进度的间隔，同时影响前端缓冲时长。数值越小越实时，数值越大越平滑。
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
                <span v-if="isSavingSettings">正在保存设置...</span>
                <span v-else-if="settingsSaveError" class="text-destructive">
                  {{ settingsSaveError }}
                </span>
                <span v-else>修改会自动保存，无需手动点击按钮。</span>
              </div>
            </CardContent>
          </Card>

          <Card class="border-border/80 shadow-sm">
            <CardHeader class="pb-3 flex items-center justify-between gap-2">
              <div>
                <CardTitle class="text-sm text-foreground">
                  开发者工具
                </CardTitle>
                <CardDescription class="mt-1 text-[11px] text-muted-foreground">
                  一键打开 Devtools，便于调试与问题排查。
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
                Devtools 将在桌面应用窗口中弹出，无需额外开关。
              </p>
            </CardContent>
          </Card>
        </div>

        <div v-else class="text-xs text-muted-foreground">
          正在从后端加载应用设置...
        </div>
      </div>
    </div>
  </section>
</template>
