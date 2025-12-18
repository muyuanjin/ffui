<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { computed, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, ExternalToolCandidate, ExternalToolKind, ExternalToolStatus } from "@/types";

type CheckUpdateLogLevel = "info" | "warn" | "error";
type CheckUpdateLogEntry = {
  atMs: number;
  level: CheckUpdateLogLevel;
  message: string;
};

const props = defineProps<{
  tool: ExternalToolStatus;
  toolStatusesFresh: boolean;
  appSettings: AppSettings | null;
  toolCustomPath: string;
  candidatesOpen: boolean;
  candidatesLoading: boolean;
  candidates: ExternalToolCandidate[];
  checkUpdateLogs: CheckUpdateLogEntry[];
  checkUpdateLoading: boolean;
  checkUpdateDisabled: boolean;
  recentlyChecked: boolean;
}>();

const {
  tool,
  toolStatusesFresh,
  appSettings,
  toolCustomPath,
  candidatesOpen,
  candidatesLoading,
  candidates,
  checkUpdateLogs,
  checkUpdateLoading,
  checkUpdateDisabled,
  recentlyChecked,
} = toRefs(props);

const emit = defineEmits<{
  toggleCandidates: [];
  useCandidate: [candidate: ExternalToolCandidate];
  updateCustomPath: [value: string | number];
  checkUpdate: [];
  download: [];
}>();

const { t } = useI18n();

const CANDIDATE_SOURCE_I18N_KEYS: Partial<Record<string, string>> = {
  custom: "app.settings.candidateSources.custom",
  download: "app.settings.candidateSources.download",
  path: "app.settings.candidateSources.path",
  env: "app.settings.candidateSources.env",
  registry: "app.settings.candidateSources.registry",
  everything: "app.settings.candidateSources.everything",
};

const getToolDisplayName = (kind: ExternalToolKind): string => {
  if (kind === "ffmpeg") return "FFmpeg";
  if (kind === "ffprobe") return "FFprobe";
  if (kind === "avifenc") return "avifenc";
  return kind;
};

const formatCandidateSource = (source: string): string => {
  const key = CANDIDATE_SOURCE_I18N_KEYS[source];
  return key ? t(key) : source;
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

const candidateHoverTitle = (candidate: ExternalToolCandidate): string => {
  const size = candidate.fileSizeBytes == null ? t("app.settings.unknownValue") : formatBytes(candidate.fileSizeBytes);
  const version = candidate.version ?? t("app.settings.unknownValue");
  return [
    candidate.path,
    `${t("app.settings.candidateFileSizeLabel")}: ${size}`,
    `${t("app.settings.candidateVersionLabel")}: ${version}`,
    `${t("app.settings.candidateSourceLabel")}: ${formatCandidateSource(candidate.source)}`,
  ].join("\n");
};

const formatLogTime = (ms: number): string => {
  const date = new Date(ms);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const checkUpdateLogCopyText = computed(() =>
  checkUpdateLogs.value
    .map((entry) => `${formatLogTime(entry.atMs)}  ${entry.level.toUpperCase()}  ${entry.message}`)
    .join("\n"),
);

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
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
</script>

<template>
  <div class="p-2 rounded border border-border/20 bg-background/50 hover:bg-accent/5 transition-colors">
    <!-- Tool header with status -->
    <div class="flex items-center justify-between mb-1.5 gap-2 min-w-0">
      <div class="flex items-center gap-2 shrink-0">
        <code class="text-[11px] font-mono font-semibold">{{ getToolDisplayName(tool.kind) }}</code>
        <span
          class="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono uppercase tracking-wider whitespace-nowrap"
          :class="
            tool.resolvedPath
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              : toolStatusesFresh
                ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
          "
        >
          {{
            tool.resolvedPath
              ? t("app.settings.toolStatus.ready")
              : toolStatusesFresh
                ? t("app.settings.toolStatus.missing")
                : t("app.settings.toolStatus.detecting")
          }}
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="opacity-0 group-hover:opacity-100 h-5 w-5 p-0.5 hover:bg-accent rounded transition-all"
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
        </Button>
      </div>
      <div class="mt-0.5 flex items-center justify-between text-[9px]">
        <Button type="button" variant="link" size="sm" class="h-auto p-0 text-[9px]" @click="emit('toggleCandidates')">
          {{ t("app.settings.selectDetectedPath") }}
        </Button>
        <span v-if="candidatesLoading" class="text-muted-foreground">
          {{ t("app.settings.loadingCandidates") }}
        </span>
      </div>

      <div v-if="candidatesOpen" class="mt-1.5 space-y-0.5 rounded border border-border/30 bg-background/60 p-1.5">
        <div
          v-if="candidatesLoading && candidates.length === 0"
          class="py-1 text-[9px] text-muted-foreground"
          data-testid="tool-candidates-loading"
        >
          {{ t("app.settings.loadingCandidates") }}
        </div>

        <div
          v-else-if="candidates.length === 0"
          class="py-1 text-[9px] text-muted-foreground"
          data-testid="tool-candidates-empty"
        >
          {{ t("app.settings.noCandidatesHint") }}
        </div>

        <template v-else>
          <div
            v-for="(candidate, index) in candidates"
            :key="candidate.path"
            class="flex items-center gap-1.5 py-0.5 border-t border-border/20 first:border-t-0"
            :data-testid="`tool-candidate-${candidate.kind}-${index}`"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <HoverCard :open-delay="200" :close-delay="80">
                  <HoverCardTrigger as-child>
                    <code
                      class="text-[9px] font-mono truncate"
                      :title="candidateHoverTitle(candidate)"
                      :data-testid="`tool-candidate-path-${candidate.kind}-${index}`"
                    >
                      {{ candidate.path }}
                    </code>
                  </HoverCardTrigger>
                  <HoverCardContent align="start" side="top" :side-offset="6" class="w-[460px] p-3">
                    <div class="space-y-2">
                      <div class="text-[11px] font-semibold text-foreground">
                        {{ getToolDisplayName(candidate.kind) }}
                      </div>
                      <div class="grid grid-cols-[56px,1fr] gap-x-3 gap-y-1 text-[10px]">
                        <div class="text-muted-foreground">
                          {{ t("app.settings.candidatePathLabel") }}
                        </div>
                        <div class="font-mono text-foreground break-all">
                          {{ candidate.path }}
                        </div>

                        <div class="text-muted-foreground">
                          {{ t("app.settings.candidateFileSizeLabel") }}
                        </div>
                        <div class="font-mono text-foreground">
                          {{
                            candidate.fileSizeBytes == null
                              ? t("app.settings.unknownValue")
                              : formatBytes(candidate.fileSizeBytes)
                          }}
                        </div>

                        <div class="text-muted-foreground">
                          {{ t("app.settings.candidateVersionLabel") }}
                        </div>
                        <div class="font-mono text-foreground">
                          {{ candidate.version ?? t("app.settings.unknownValue") }}
                        </div>

                        <div class="text-muted-foreground">
                          {{ t("app.settings.candidateSourceLabel") }}
                        </div>
                        <div class="text-foreground">
                          {{ formatCandidateSource(candidate.source) }}
                        </div>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
                <span class="px-1 py-0 rounded-full text-[8px] border border-border/40 text-muted-foreground">
                  {{ formatCandidateSource(candidate.source) }}
                </span>
              </div>
              <div v-if="candidate.version" class="text-[9px] text-muted-foreground truncate">
                {{ candidate.version }}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-5 px-2 text-[9px]"
              :class="
                candidate.isCurrent
                  ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                  : ''
              "
              @click="emit('useCandidate', candidate)"
            >
              {{ candidate.isCurrent ? t("app.settings.candidateCurrentLabel") : t("app.settings.useDetectedPath") }}
            </Button>
          </div>
        </template>
      </div>
    </div>

    <!-- Custom path input -->
    <div v-if="appSettings" class="flex items-center gap-1.5">
      <span class="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">CUSTOM:</span>
      <Input
        :model-value="toolCustomPath"
        :placeholder="t('app.settings.customToolPathPlaceholder')"
        class="h-6 text-[10px] font-mono bg-background/50 border-border/30 px-2"
        @update:model-value="(value) => emit('updateCustomPath', value)"
      />
    </div>

    <!-- Update available / manual download actions -->
    <div class="mt-1 flex items-center justify-between text-[9px]">
      <span v-if="tool.updateAvailable && !tool.lastDownloadError" class="text-amber-600">
        {{ t("app.settings.updateAvailableHint", { version: tool.remoteVersion ?? tool.version ?? "?" }) }}
      </span>
      <span v-else-if="tool.resolvedPath && !tool.updateAvailable && !tool.lastDownloadError" class="text-emerald-600">
        {{ t("app.settings.toolUpToDateHint") }}
      </span>
      <div class="flex items-center gap-1.5">
        <HoverCard v-if="!tool.downloadInProgress && checkUpdateLogs.length > 0" :open-delay="180" :close-delay="90">
          <HoverCardTrigger as-child>
            <Button
              :data-testid="`tool-check-update-${tool.kind}`"
              variant="ghost"
              size="sm"
              class="h-5 px-2 text-[9px]"
              :disabled="checkUpdateDisabled"
              @click="emit('checkUpdate')"
            >
              {{
                checkUpdateLoading
                  ? t("app.settings.checkToolUpdateCheckingButton")
                  : recentlyChecked
                    ? t("app.settings.checkToolUpdateDoneHint")
                    : t("app.settings.checkToolUpdateButton")
              }}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent
            align="end"
            side="bottom"
            :side-offset="8"
            :collision-padding="12"
            :prioritize-position="true"
            sticky="always"
            class="w-[min(620px,var(--reka-hover-card-content-available-width))] p-3"
            :data-testid="`tool-check-update-hover-${tool.kind}`"
          >
            <div class="flex items-center justify-end gap-2 mb-2">
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px]"
                :data-testid="`tool-check-update-hover-copy-${tool.kind}`"
                @click="copyToClipboard(checkUpdateLogCopyText)"
              >
                {{ t("app.settings.checkToolUpdateLogCopy") }}
              </Button>
            </div>
            <div
              class="rounded border border-border/30 bg-background/60 p-2 max-h-[calc(100vh-180px)] overflow-auto select-text"
              :data-testid="`tool-check-update-hover-log-${tool.kind}`"
            >
              <div
                v-for="(entry, idx) in checkUpdateLogs"
                :key="idx"
                class="flex gap-2 leading-snug text-[10px] font-mono"
                :class="
                  entry.level === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : entry.level === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground'
                "
              >
                <span class="opacity-70 shrink-0 tabular-nums">{{ formatLogTime(entry.atMs) }}</span>
                <span class="opacity-60 shrink-0">{{ entry.level.toUpperCase() }}</span>
                <span class="whitespace-pre-wrap break-words">{{ entry.message }}</span>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
        <Button
          v-else-if="!tool.downloadInProgress"
          :data-testid="`tool-check-update-${tool.kind}`"
          variant="ghost"
          size="sm"
          class="h-5 px-2 text-[9px]"
          :disabled="checkUpdateDisabled"
          @click="emit('checkUpdate')"
        >
          {{
            checkUpdateLoading
              ? t("app.settings.checkToolUpdateCheckingButton")
              : recentlyChecked
                ? t("app.settings.checkToolUpdateDoneHint")
                : t("app.settings.checkToolUpdateButton")
          }}
        </Button>
        <Button
          v-if="!tool.downloadInProgress && (tool.updateAvailable || !tool.resolvedPath)"
          data-testid="tool-download-action"
          variant="outline"
          size="sm"
          class="h-5 px-2 text-[9px]"
          @click="emit('download')"
        >
          {{ tool.updateAvailable ? t("app.settings.updateToolButton") : t("app.settings.downloadToolButton") }}
        </Button>
      </div>
    </div>

    <!-- Download error message -->
    <p v-if="tool.lastDownloadError" class="mt-1 text-[9px] text-red-600 dark:text-red-400 leading-snug">
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
          <span v-if="tool.totalBytes != null"> / {{ formatBytes(tool.totalBytes) }} </span>
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
</template>
