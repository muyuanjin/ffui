<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ExternalToolCard from "@/components/panels/settings-external-tools/ExternalToolCard.vue";
import { useI18n } from "vue-i18n";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AppSettings, ExternalToolCandidate, ExternalToolKind, ExternalToolStatus } from "@/types";

type CheckUpdateLogLevel = "info" | "warn" | "error";
type CheckUpdateLogEntry = {
  atMs: number;
  level: CheckUpdateLogLevel;
  message: string;
};

const props = defineProps<{
  appSettings: AppSettings | null;
  toolStatuses: ExternalToolStatus[];
  /** Whether tool statuses have been refreshed at least once this session. */
  toolStatusesFresh?: boolean;
  fetchToolCandidates: (kind: ExternalToolKind) => Promise<ExternalToolCandidate[]>;
  refreshToolStatuses?: (options?: {
    remoteCheck?: boolean;
    manualRemoteCheck?: boolean;
    remoteCheckKind?: ExternalToolKind;
  }) => Promise<void>;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
  downloadTool: [kind: ExternalToolKind];
}>();

const { t } = useI18n();

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let refreshTimer: number | undefined;

const isAutoManaged = computed(() => {
  const tools = props.appSettings?.tools;
  return !!tools?.autoDownload && !!tools?.autoUpdate;
});

const toolStatusesFresh = computed(() => props.toolStatusesFresh ?? true);

const scheduleAutoRefresh = () => {
  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (!props.refreshToolStatuses) return;

  // Always refresh local probe work when the Tools panel is opened so the UI
  // can reflect PATH/custom/downloaded binaries without blocking startup.
  void props.refreshToolStatuses({ remoteCheck: isAutoManaged.value });

  // Remote checks are opt-in: only run (and schedule) when auto-managed is enabled.
  if (isAutoManaged.value) {
    refreshTimer = window.setInterval(() => {
      void props.refreshToolStatuses?.({ remoteCheck: true });
    }, REFRESH_INTERVAL_MS);
  }
};

onMounted(() => {
  scheduleAutoRefresh();
});

watch(isAutoManaged, () => {
  scheduleAutoRefresh();
});

onUnmounted(() => {
  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
});

const checkUpdateLoadingKind = ref<ExternalToolKind | null>(null);
const checkUpdateRequestId = ref(0);
const checkUpdateActiveRequest = ref<{
  id: number;
  kind: ExternalToolKind;
  startedAtMs: number;
  timeoutId?: number;
} | null>(null);

const checkUpdateLogsByKind = ref<Partial<Record<ExternalToolKind, CheckUpdateLogEntry[]>>>({});

const getCheckUpdateLogs = (kind: ExternalToolKind): CheckUpdateLogEntry[] => {
  return checkUpdateLogsByKind.value[kind] ?? [];
};

const setCheckUpdateLogs = (kind: ExternalToolKind, logs: CheckUpdateLogEntry[]) => {
  checkUpdateLogsByKind.value = { ...checkUpdateLogsByKind.value, [kind]: logs };
};

const appendCheckUpdateLog = (kind: ExternalToolKind, message: string, level: CheckUpdateLogLevel = "info") => {
  const next = [...getCheckUpdateLogs(kind), { atMs: Date.now(), level, message }];
  const MAX_LINES = 80;
  setCheckUpdateLogs(kind, next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next);
};

const checkUpdateLogsFor = (kind: ExternalToolKind): CheckUpdateLogEntry[] => getCheckUpdateLogs(kind);

const lastManualUpdateCheckAtMs = ref<Partial<Record<ExternalToolKind, number>>>({});

watch(
  () => props.toolStatuses,
  (next) => {
    const request = checkUpdateActiveRequest.value;
    if (!request) return;
    if (checkUpdateLoadingKind.value !== request.kind) return;

    if (request.timeoutId !== undefined) {
      window.clearTimeout(request.timeoutId);
    }

    appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSnapshotReceived"));

    const status = next.find((s) => s.kind === request.kind);
    if (!status) {
      appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultToolMissing"), "warn");
    } else {
      appendCheckUpdateLog(
        request.kind,
        t("app.settings.checkToolUpdateLogSummaryLocalPath", {
          path: status.resolvedPath ?? "-",
        }),
      );
      appendCheckUpdateLog(
        request.kind,
        t("app.settings.checkToolUpdateLogSummaryLocalVersion", {
          version: status.version ?? "-",
        }),
      );
      appendCheckUpdateLog(
        request.kind,
        t("app.settings.checkToolUpdateLogSummaryRemoteVersion", {
          version: status.remoteVersion ?? "-",
        }),
      );

      if (status.lastRemoteCheckError) {
        appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultRemoteCheckFailed"), "error");
        appendCheckUpdateLog(request.kind, status.lastRemoteCheckError, "error");
      } else {
        if (!status.resolvedPath) {
          appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultToolMissing"), "warn");
        } else if (!status.remoteVersion) {
          appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultRemoteUnknown"), "warn");
        } else if (status.updateAvailable) {
          appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultUpdateAvailable"));
        } else {
          appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogSummaryResultUpToDate"));
        }

        if (status.lastRemoteCheckMessage && status.lastRemoteCheckMessage.startsWith("[proxy]")) {
          appendCheckUpdateLog(request.kind, status.lastRemoteCheckMessage, "warn");
        }
      }
    }

    const elapsedSeconds = ((Date.now() - request.startedAtMs) / 1000).toFixed(1);
    appendCheckUpdateLog(request.kind, t("app.settings.checkToolUpdateLogDuration", { seconds: elapsedSeconds }));

    checkUpdateLoadingKind.value = null;
    checkUpdateActiveRequest.value = null;
    lastManualUpdateCheckAtMs.value = {
      ...lastManualUpdateCheckAtMs.value,
      [request.kind]: Date.now(),
    };
  },
  { deep: false },
);

const handleCheckToolUpdate = async (kind: ExternalToolKind) => {
  if (!props.refreshToolStatuses) return;
  if (checkUpdateLoadingKind.value) return;

  checkUpdateLoadingKind.value = kind;
  const id = ++checkUpdateRequestId.value;
  const startedAtMs = Date.now();

  setCheckUpdateLogs(kind, []);
  appendCheckUpdateLog(kind, t("app.settings.checkToolUpdateLogStarted"));
  appendCheckUpdateLog(kind, t("app.settings.checkToolUpdateLogRequestSent"));

  const timeoutSeconds = 20;
  const timeoutId = window.setTimeout(() => {
    const active = checkUpdateActiveRequest.value;
    if (!active || active.id !== id) return;
    appendCheckUpdateLog(kind, t("app.settings.checkToolUpdateLogTimeout", { seconds: timeoutSeconds }), "warn");
    checkUpdateLoadingKind.value = null;
    checkUpdateActiveRequest.value = null;
  }, timeoutSeconds * 1000);

  checkUpdateActiveRequest.value = { id, kind, startedAtMs, timeoutId };

  try {
    await props.refreshToolStatuses({ remoteCheck: true, manualRemoteCheck: true, remoteCheckKind: kind });
    if (checkUpdateActiveRequest.value?.id !== id) return;
    appendCheckUpdateLog(kind, t("app.settings.checkToolUpdateLogAwaitingSnapshot"));
  } catch (error) {
    if (checkUpdateActiveRequest.value?.id === id) {
      appendCheckUpdateLog(
        kind,
        t("app.settings.checkToolUpdateLogInvokeError", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
      window.clearTimeout(timeoutId);
      checkUpdateLoadingKind.value = null;
      checkUpdateActiveRequest.value = null;
    }
  }
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
  // Once the user explicitly picks a path (either by typing or by choosing
  // from detected candidates), switch the management mode to “手动管理”
  // so that future auto-download/update will not override the chosen binary.
  tools.autoDownload = false;
  tools.autoUpdate = false;
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

const candidateKind = ref<ExternalToolKind | null>(null);
const candidatesByKind = ref<Partial<Record<ExternalToolKind, ExternalToolCandidate[]>>>({});
const candidatesFetchedAt = ref<Partial<Record<ExternalToolKind, number>>>({});
const candidatesLoadingKind = ref<ExternalToolKind | null>(null);
let candidateRequestId = 0;
const CANDIDATE_CACHE_TTL_MS = 30_000;

const currentCandidates = computed<ExternalToolCandidate[]>(() => {
  if (!candidateKind.value) return [];
  return candidatesByKind.value[candidateKind.value] ?? [];
});

const loadCandidates = async (kind: ExternalToolKind) => {
  // Toggle: clicking the same tool closes the list without re-querying.
  if (candidateKind.value === kind) {
    candidateKind.value = null;
    return;
  }
  candidateKind.value = kind;
  const now = Date.now();
  const lastFetched = candidatesFetchedAt.value[kind] ?? 0;
  const cached = candidatesByKind.value[kind];
  // Avoid re-querying heavy discovery (Everything SDK) repeatedly; reuse a
  // recent snapshot but still allow refresh after a short TTL.
  if (cached && now - lastFetched < CANDIDATE_CACHE_TTL_MS) {
    return;
  }

  const requestId = ++candidateRequestId;
  candidatesLoadingKind.value = kind;
  try {
    const result = await props.fetchToolCandidates(kind);
    if (requestId !== candidateRequestId) return;
    candidatesByKind.value = { ...candidatesByKind.value, [kind]: result };
    candidatesFetchedAt.value = { ...candidatesFetchedAt.value, [kind]: Date.now() };
  } catch (error) {
    console.error("Failed to load external tool candidates", error);
    if (requestId !== candidateRequestId) return;
    candidatesByKind.value = { ...candidatesByKind.value, [kind]: [] };
    candidatesFetchedAt.value = { ...candidatesFetchedAt.value, [kind]: Date.now() };
  } finally {
    if (requestId === candidateRequestId) {
      candidatesLoadingKind.value = null;
    }
  }
};

const handleUseCandidate = (candidate: ExternalToolCandidate) => {
  if (candidate.isCurrent) return;
  setToolCustomPath(candidate.kind, candidate.path);
  const current = candidatesByKind.value[candidate.kind] ?? [];
  candidatesByKind.value = {
    ...candidatesByKind.value,
    [candidate.kind]: current.map((item) => ({
      ...item,
      isCurrent: item.path === candidate.path,
    })),
  };
};

const showRecentlyCheckedHint = (kind: ExternalToolKind): boolean => {
  const ts = lastManualUpdateCheckAtMs.value[kind] ?? 0;
  if (!ts) return false;
  return Date.now() - ts < 6_000;
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-tool-management">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.externalToolsTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2">
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="settings-tool-management-grid">
        <ExternalToolCard
          v-for="tool in toolStatuses"
          :key="tool.kind"
          :tool="tool"
          :tool-statuses-fresh="toolStatusesFresh"
          :app-settings="appSettings"
          :tool-custom-path="getToolCustomPath(tool.kind)"
          :candidates-open="candidateKind === tool.kind"
          :candidates-loading="candidatesLoadingKind === tool.kind"
          :candidates="candidateKind === tool.kind ? currentCandidates : []"
          :check-update-logs="checkUpdateLogsFor(tool.kind)"
          :check-update-loading="checkUpdateLoadingKind === tool.kind"
          :check-update-disabled="!refreshToolStatuses || !!checkUpdateLoadingKind"
          :recently-checked="showRecentlyCheckedHint(tool.kind)"
          @toggle-candidates="loadCandidates(tool.kind)"
          @use-candidate="handleUseCandidate"
          @update-custom-path="(value) => setToolCustomPath(tool.kind, value)"
          @check-update="handleCheckToolUpdate(tool.kind)"
          @download="emit('downloadTool', tool.kind)"
        />
      </div>
    </CardContent>
  </Card>
</template>
