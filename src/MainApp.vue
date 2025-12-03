<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  AutoCompressProgress,
  CpuUsageSnapshot,
  ExternalToolStatus,
  FFmpegPreset,
  GpuUsageSnapshot,
  JobStatus,
  QueueState,
  SmartScanConfig,
  TranscodeJob,
} from "./types";
import { DEFAULT_SMART_SCAN_CONFIG, EXTENSIONS } from "./constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { highlightFfmpegCommand, escapeHtml, normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";
import { useI18n } from "vue-i18n";
import type { AppLocale } from "./i18n";
import { DEFAULT_LOCALE, loadLocale } from "./i18n";
import {
  fetchCpuUsage,
  fetchExternalToolStatuses,
  fetchGpuUsage,
  buildPreviewUrl,
  hasTauri,
  loadAppSettings,
  loadPresets,
  loadQueueState,
  loadPreviewDataUrl,
  runAutoCompress,
  saveAppSettings,
  savePresetOnBackend,
  deletePresetOnBackend,
  enqueueTranscodeJob,
  cancelTranscodeJob,
} from "@/lib/backend";

// Heavy UI subtrees are loaded lazily so the initial bundle stays smaller.
const QueueItem = defineAsyncComponent(() => import("./components/QueueItem.vue"));
const ParameterWizard = defineAsyncComponent(() => import("./components/ParameterWizard.vue"));
const UltimateParameterPanel = defineAsyncComponent(
  () => import("./components/UltimateParameterPanel.vue"),
);
const SmartScanWizard = defineAsyncComponent(() => import("./components/SmartScanWizard.vue"));

const MAX_CONCURRENT_JOBS = 2;

const appWindow = ref<TauriWindow | null>(null);

const INITIAL_PRESETS: FFmpegPreset[] = [
  {
    id: "p1",
    name: "Universal 1080p",
    description: "x264 Medium CRF 23. Standard for web.",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
    audio: { codec: "copy" },
    filters: { scale: "-2:1080" },
    stats: { usageCount: 5, totalInputSizeMB: 2500, totalOutputSizeMB: 800, totalTimeSeconds: 420 },
  },
  {
    id: "p2",
    name: "Archive Master",
    description: "x264 Slow CRF 18. Near lossless.",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
    audio: { codec: "copy" },
    filters: {},
    stats: { usageCount: 2, totalInputSizeMB: 5000, totalOutputSizeMB: 3500, totalTimeSeconds: 1200 },
  },
];

const activeTab = ref<"queue" | "presets" | "media" | "monitor" | "settings">("queue");
const presets = ref<FFmpegPreset[]>([...INITIAL_PRESETS]);
const presetsLoadedFromBackend = ref(false);
const jobs = ref<TranscodeJob[]>([]);
const smartScanJobs = ref<TranscodeJob[]>([]);
const manualJobPresetId = ref<string | null>(null);

const manualJobPreset = computed<FFmpegPreset | null>(() => {
  const list = presets.value;
  if (!list || list.length === 0) return null;
  const id = manualJobPresetId.value;
  if (!id) return list[0];
  return list.find((p) => p.id === id) ?? list[0];
});

type CompositeSmartScanTask = {
  batchId: string;
  rootPath: string;
  jobs: TranscodeJob[];
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
  overallProgress: number;
  currentJob: TranscodeJob | null;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
};

type QueueListItem =
  | { kind: "batch"; batch: CompositeSmartScanTask }
  | { kind: "job"; job: TranscodeJob };

const smartScanBatchMeta = ref<
  Record<
    string,
    {
      rootPath: string;
      totalFilesScanned: number;
      totalCandidates: number;
      totalProcessed: number;
      startedAtMs?: number;
      completedAtMs?: number;
    }
  >
>({});

const applySmartScanBatchMetaSnapshot = (snapshot: {
  batchId: string;
  rootPath: string;
  totalFilesScanned: number;
  totalCandidates: number;
  totalProcessed: number;
  startedAtMs?: number;
  completedAtMs?: number;
}) => {
  const prev = smartScanBatchMeta.value[snapshot.batchId];

  const next = {
    rootPath: snapshot.rootPath || prev?.rootPath || "",
    totalFilesScanned: Math.max(
      prev?.totalFilesScanned ?? 0,
      snapshot.totalFilesScanned,
    ),
    totalCandidates: Math.max(
      prev?.totalCandidates ?? 0,
      snapshot.totalCandidates,
    ),
    totalProcessed: Math.max(
      prev?.totalProcessed ?? 0,
      snapshot.totalProcessed,
    ),
    startedAtMs: prev?.startedAtMs ?? snapshot.startedAtMs,
    completedAtMs: snapshot.completedAtMs ?? prev?.completedAtMs,
  };

  smartScanBatchMeta.value = {
    ...smartScanBatchMeta.value,
    [snapshot.batchId]: next,
  };
};

const expandedBatchIds = ref<Set<string>>(new Set());
const showWizard = ref(false);
const showParameterPanel = ref(false);
const editingPreset = ref<FFmpegPreset | null>(null);
const showSmartScan = ref(false);
const smartConfig = ref<SmartScanConfig>({ ...DEFAULT_SMART_SCAN_CONFIG });
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const folderInputRef = ref<HTMLInputElement | null>(null);
const pendingSmartScanAfterFolder = ref(false);
const presetPendingDelete = ref<FFmpegPreset | null>(null);
const lastDroppedRoot = ref<string | null>(null);
const appSettings = ref<AppSettings | null>(null);
const cpuSnapshot = ref<CpuUsageSnapshot | null>(null);
const gpuSnapshot = ref<GpuUsageSnapshot | null>(null);
const toolStatuses = ref<ExternalToolStatus[]>([]);
let jobTimer: number | undefined;
let queueTimer: number | undefined;
let monitorTimer: number | undefined;
const queueError = ref<string | null>(null);
const selectedJobForDetail = ref<TranscodeJob | null>(null);
const jobDetailFallbackPreviewUrl = ref<string | null>(null);

let dragDropUnlisten: UnlistenFn | null = null;
let queueUnlisten: UnlistenFn | null = null;
let smartScanProgressUnlisten: UnlistenFn | null = null;

const { t, locale } = useI18n();

const currentLocale = computed<AppLocale>({
  get: () =>
    locale.value === "zh-CN" || locale.value === "en" ? (locale.value as AppLocale) : DEFAULT_LOCALE,
  set: (value) => {
    void loadLocale(value);
  },
});

const canUseTauriWindow = () => {
  if (typeof window === "undefined") return false;
  // In Tauri, a __TAURI__ global is injected on window; this is enough to safely call getCurrentWindow().
  return "__TAURI__" in (window as any);
};

const currentTitle = computed(() => {
  if (activeTab.value === "queue") return t("app.tabs.queue");
  if (activeTab.value === "presets") return t("app.tabs.presets");
  if (activeTab.value === "media") return t("app.tabs.media");
  if (activeTab.value === "monitor") return t("app.tabs.monitor");
  if (activeTab.value === "settings") return t("app.tabs.settings");
  return t("app.tabs.queue");
});

const currentSubtitle = computed(() => {
  if (activeTab.value === "queue") return t("app.queueHint");
  if (activeTab.value === "presets") return t("app.presetsHint");
  if (activeTab.value === "media") return t("app.mediaHint");
  if (activeTab.value === "monitor") return t("app.monitorHint");
  if (activeTab.value === "settings") return t("app.settingsHint");
  return "";
});

const detailStatusLabel = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job) return "";
  return t(`queue.status.${job.status}`) as string;
});

const detailStatusBadgeClass = computed(() => {
  const job = selectedJobForDetail.value;
  const status = job?.status;
  switch (status) {
    case "completed":
      return "border-emerald-500/60 text-emerald-400 bg-emerald-500/10";
    case "processing":
      return "border-blue-500/60 text-blue-400 bg-blue-500/10";
    case "waiting":
    case "queued":
      return "border-amber-500/60 text-amber-400 bg-amber-500/10";
    case "failed":
      return "border-red-500/60 text-red-400 bg-red-500/10";
    case "cancelled":
    case "skipped":
      return "border-muted-foreground/40 text-muted-foreground bg-muted/40";
    default:
      return "border-border text-muted-foreground bg-muted/20";
  }
});

const detailSourceLabel = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job) return "";
  if (job.source === "smart_scan") {
    return t("queue.source.smartScan") as string;
  }
  return t("queue.source.manual") as string;
});

const detailPreset = computed<FFmpegPreset | null>(() => {
  const job = selectedJobForDetail.value;
  if (!job) return null;
  const id = job.presetId;
  if (!id) return null;
  return presets.value.find((p) => p.id === id) ?? null;
});

const detailPresetLabel = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job) return "";
  const preset = detailPreset.value;
  if (preset) return preset.name;

  if (job.presetId) {
    const raw = t("taskDetail.unknownPreset", { id: job.presetId }) as string;
    if (raw && raw !== "taskDetail.unknownPreset") {
      return raw;
    }
    return `Unknown preset (${job.presetId})`;
  }

  return "";
});

const compositeSmartScanTasks = computed<CompositeSmartScanTask[]>(() => {
  const byBatch: Record<string, { jobs: TranscodeJob[] }> = {};

  for (const job of jobs.value) {
    const batchId = job.batchId;
    if (!batchId) continue;
    if (!byBatch[batchId]) {
      byBatch[batchId] = { jobs: [] };
    }
    byBatch[batchId].jobs.push(job);
  }

  return Object.entries(byBatch).map(([batchId, entry]) => {
    const batchJobs = entry.jobs;
    const meta = smartScanBatchMeta.value[batchId];
    const totalCount = batchJobs.length;

    let completedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let progressSum = 0;
    let currentJob: TranscodeJob | null = null;

    for (const job of batchJobs) {
      switch (job.status) {
        case "completed":
          completedCount += 1;
          progressSum += 1;
          break;
        case "skipped":
          skippedCount += 1;
          progressSum += 1;
          break;
        case "failed":
          failedCount += 1;
          progressSum += 1;
          break;
        case "cancelled":
          cancelledCount += 1;
          progressSum += 1;
          break;
        case "processing":
          progressSum += (job.progress ?? 0) / 100;
          if (
            !currentJob ||
            (job.startTime ?? 0) > (currentJob.startTime ?? 0)
          ) {
            currentJob = job;
          }
          break;
        default:
          break;
      }
    }

    const overallProgress =
      totalCount > 0 ? (progressSum / totalCount) * 100 : 0;

    const rootPathFromMeta = meta?.rootPath;
    let rootPath = rootPathFromMeta ?? "";
    if (!rootPath) {
      const first = batchJobs[0];
      const raw = first?.inputPath || first?.filename || "";
      if (raw) {
        const normalized = raw.replace(/\\/g, "/");
        const lastSlash = normalized.lastIndexOf("/");
        rootPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized;
      }
    }

    return {
      batchId,
      rootPath,
      jobs: batchJobs,
      totalFilesScanned: meta?.totalFilesScanned ?? totalCount,
      totalCandidates: meta?.totalCandidates ?? totalCount,
      totalProcessed: meta?.totalProcessed ?? completedCount,
      startedAtMs: meta?.startedAtMs,
      completedAtMs: meta?.completedAtMs,
      overallProgress,
      currentJob,
      completedCount,
      skippedCount,
      failedCount,
      cancelledCount,
      totalCount,
    };
  });
});

const compositeTasksById = computed(() => {
  const map = new Map<string, CompositeSmartScanTask>();
  for (const task of compositeSmartScanTasks.value) {
    map.set(task.batchId, task);
  }
  return map;
});

const visibleQueueItems = computed<QueueListItem[]>(() => {
  const items: QueueListItem[] = [];
  const seenBatches = new Set<string>();
  const byId = compositeTasksById.value;

  for (const job of jobs.value) {
    const batchId = job.batchId;
    if (batchId && byId.has(batchId)) {
      if (seenBatches.has(batchId)) {
        continue;
      }
      const batch = byId.get(batchId)!;
      items.push({ kind: "batch", batch });
      seenBatches.add(batchId);
    } else if (!batchId) {
      items.push({ kind: "job", job });
    }
  }

  return items;
});

const isBatchExpanded = (batchId: string) => expandedBatchIds.value.has(batchId);

const toggleBatchExpanded = (batchId: string) => {
  const next = new Set(expandedBatchIds.value);
  if (next.has(batchId)) {
    next.delete(batchId);
  } else {
    next.add(batchId);
  }
  expandedBatchIds.value = next;
};

const jobDetailTitle = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job) return "";
  const raw = job.inputPath || job.filename || "";
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
});

const jobDetailDurationSeconds = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job?.startTime || !job.endTime || job.endTime <= job.startTime) return null;
  return (job.endTime - job.startTime) / 1000;
});

const jobDetailPreviewUrl = computed(() => {
  const job = selectedJobForDetail.value;
  const path = job?.previewPath;

  // If we have already loaded a fallback data URL from the backend, always
  // prefer that over the raw file path / asset URL.
  if (jobDetailFallbackPreviewUrl.value) {
    return jobDetailFallbackPreviewUrl.value;
  }

  return buildPreviewUrl(path ?? null);
});

const expandedPreviewOpen = ref(false);

const expandedPreviewUrl = computed(() => {
  const job = selectedJobForDetail.value;
  const path = job?.inputPath;
  if (!path) return null;

  // In pure web environments we cannot safely load local filesystem paths, so
  // keep the dialog in a text-only fallback state.
  if (!hasTauri()) return null;

  return buildPreviewUrl(path);
});

const jobDetailLogText = computed(() => {
  const job = selectedJobForDetail.value;
  if (!job) return "";
  const tail = job.logTail ?? "";
  const full = (job.logs ?? []).join("\n");
  // Prefer the backend-provided tail (already size-limited); fall back to the
  // concatenated in-memory logs if no tail is available.
  return tail || full;
});

const showTemplateCommand = ref(true);

const jobDetailRawCommand = computed(() => {
  const job = selectedJobForDetail.value;
  return job?.ffmpegCommand ?? "";
});

const jobDetailTemplateCommand = computed(() => {
  const raw = jobDetailRawCommand.value;
  if (!raw) return "";
  const result = normalizeFfmpegTemplate(raw);
  return result.template;
});

const jobDetailEffectiveCommand = computed(() => {
  const raw = jobDetailRawCommand.value;
  const templ = jobDetailTemplateCommand.value;
  if (showTemplateCommand.value) {
    return templ || raw;
  }
  return raw;
});

const jobDetailHasDistinctTemplate = computed(() => {
  const raw = jobDetailRawCommand.value;
  const templ = jobDetailTemplateCommand.value;
  return !!raw && !!templ && templ !== raw;
});

const commandViewToggleLabel = computed(() => {
  if (!jobDetailHasDistinctTemplate.value) return "";
  return showTemplateCommand.value ? "显示完整命令" : "显示模板视图";
});

const toggleCommandView = () => {
  if (!jobDetailHasDistinctTemplate.value) return;
  showTemplateCommand.value = !showTemplateCommand.value;
};

const highlightedCommandHtml = computed(() => {
  return highlightFfmpegCommand(jobDetailEffectiveCommand.value);
});

type LogLineKind = "version" | "stream" | "progress" | "error" | "other";

interface LogLineEntry {
  text: string;
  kind: LogLineKind;
}

const classifyLogLine = (line: string): LogLineKind => {
  const lower = line.toLowerCase();
  if (lower.includes("ffmpeg version")) return "version";
  if (lower.trimStart().startsWith("stream #") || lower.includes("video:") || lower.includes("audio:")) {
    return "stream";
  }
  if (lower.trimStart().startsWith("frame=") || (lower.includes("time=") && lower.includes("speed="))) {
    return "progress";
  }
  if (lower.includes("error") || lower.includes("failed") || lower.includes("exited with")) {
    return "error";
  }
  return "other";
};

const logLineClass = (kind: LogLineKind): string => {
  switch (kind) {
    case "version":
    case "stream":
      return "leading-relaxed text-[11px] text-muted-foreground";
    case "progress":
      return "leading-relaxed text-[11px] text-foreground";
    case "error":
      return "leading-relaxed text-[11px] text-destructive font-medium";
    default:
      return "leading-relaxed text-[11px] text-foreground";
  }
};

const highlightedLogHtml = computed(() => {
  const raw = jobDetailLogText.value;
  if (!raw) return "";

  const lines = raw.split(/\r?\n/);
  const entries: LogLineEntry[] = lines.map((line) => ({
    text: line,
    kind: classifyLogLine(line),
  }));

  return entries
    .map((entry) => {
      const cls = logLineClass(entry.kind);
      const escaped = escapeHtml(entry.text);
      return `<div class="${cls}">${escaped}</div>`;
    })
    .join("\n");
});

const handlePreviewImageError = () => {
  const job = selectedJobForDetail.value;
  const path = job?.previewPath;
  if (!job || !path) return;
  if (!hasTauri()) return;

  // Avoid hammering the backend if the image keeps failing to load for some
  // reason; we only try the fallback once per job selection.
  if (jobDetailFallbackPreviewUrl.value) return;

  void (async () => {
    try {
      jobDetailFallbackPreviewUrl.value = await loadPreviewDataUrl(path);
    } catch (error) {
      console.error("Failed to load preview image via data URL fallback", error);
    }
  })();
};

const getPresetAvgRatio = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const output = preset.stats.totalOutputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) return null;
  const ratio = (1 - output / input) * 100;
  return Math.max(Math.min(ratio, 100), -100);
};

const getPresetAvgSpeed = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const time = preset.stats.totalTimeSeconds;
  if (!input || !time || time <= 0) return null;
  return input / time;
};

const updatePresetStats = (presetId: string, input: number, output: number, timeSeconds: number) => {
  presets.value = presets.value.map((preset) =>
    preset.id === presetId
      ? {
          ...preset,
          stats: {
            usageCount: preset.stats.usageCount + 1,
            totalInputSizeMB: preset.stats.totalInputSizeMB + input,
            totalOutputSizeMB: preset.stats.totalOutputSizeMB + output,
            totalTimeSeconds: preset.stats.totalTimeSeconds + timeSeconds,
          },
        }
      : preset,
  );
};

const openJobDetail = (job: TranscodeJob) => {
  selectedJobForDetail.value = job;
};

const closeJobDetail = () => {
  selectedJobForDetail.value = null;
};

const openExpandedPreview = () => {
  const job = selectedJobForDetail.value;
  if (!job?.inputPath) return;
  expandedPreviewOpen.value = true;
};

const closeExpandedPreview = () => {
  expandedPreviewOpen.value = false;
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

const handleCompletedJobFromBackend = (job: TranscodeJob) => {
  const input = job.originalSizeMB;
  const output = job.outputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) {
    return;
  }
  if (!job.startTime || !job.endTime || job.endTime <= job.startTime) {
    return;
  }
  const durationSeconds = (job.endTime - job.startTime) / 1000;
  updatePresetStats(job.presetId, input, output, durationSeconds);
};

watch(
  selectedJobForDetail,
  () => {
    // Reset any previously loaded fallback preview when the user switches to
    // a different job so that we recompute the correct URL.
    jobDetailFallbackPreviewUrl.value = null;
    expandedPreviewOpen.value = false;
  },
  { flush: "pre" },
);

watch(
  presets,
  (list) => {
    if (!list || list.length === 0) {
      manualJobPresetId.value = null;
      return;
    }
    if (!manualJobPresetId.value || !list.some((p) => p.id === manualJobPresetId.value)) {
      manualJobPresetId.value = list[0].id;
    }
  },
  { immediate: true },
);

const recomputeJobsFromBackend = (backendJobs: TranscodeJob[]) => {
  jobs.value = [...smartScanJobs.value, ...backendJobs];
};

const applyQueueStateFromBackend = (state: QueueState) => {
  recomputeJobsFromBackend(state.jobs);
};

const refreshQueueFromBackend = async () => {
  if (!hasTauri()) return;
  try {
    const previousJobs = jobs.value;
    const previousById = new Map(previousJobs.map((job) => [job.id, job]));
    const state = await loadQueueState();
    const backendJobs = state.jobs ?? [];

    for (const job of backendJobs) {
      const prev = previousById.get(job.id);
      if (job.status === "completed" && (!prev || prev.status !== "completed")) {
        handleCompletedJobFromBackend(job);
      }
    }

    recomputeJobsFromBackend(backendJobs);
    queueError.value = null;
  } catch (error) {
    console.error("Failed to refresh queue state", error);
    queueError.value =
      (t("queue.error.loadFailed") as string) ||
      "队列状态刷新失败，可能是后端未运行或外部工具初始化失败。请检查“软件设置”中的路径与自动下载配置。";
  }
};

const handleSavePreset = async (preset: FFmpegPreset) => {
  let nextPresets: FFmpegPreset[];

  if (hasTauri()) {
    try {
      // Persist to the Tauri backend so the transcoding engine can resolve
      // this preset id when processing queued jobs.
      nextPresets = await savePresetOnBackend(preset);
    } catch (error) {
      console.error("Failed to save preset on backend, falling back to local state", error);
      nextPresets = editingPreset.value
        ? presets.value.map((p) => (p.id === preset.id ? preset : p))
        : [...presets.value, preset];
    }
  } else {
    nextPresets = editingPreset.value
      ? presets.value.map((p) => (p.id === preset.id ? preset : p))
      : [...presets.value, preset];
  }

  presets.value = nextPresets;
  showWizard.value = false;
  showParameterPanel.value = false;
  editingPreset.value = null;
  activeTab.value = "presets";
};

const openNewPresetWizard = () => {
  editingPreset.value = null;
  showWizard.value = true;
  showParameterPanel.value = false;
};

const openEditPresetWizard = (preset: FFmpegPreset) => {
  editingPreset.value = preset;
  showWizard.value = false;
  showParameterPanel.value = true;
};

const openPresetPanelFromWizard = (preset: FFmpegPreset) => {
  editingPreset.value = preset;
  showWizard.value = false;
  showParameterPanel.value = true;
};

const openPresetWizardFromPanel = (preset: FFmpegPreset) => {
  editingPreset.value = preset;
  showParameterPanel.value = false;
  showWizard.value = true;
};

const requestDeletePreset = (preset: FFmpegPreset) => {
  presetPendingDelete.value = preset;
};

const confirmDeletePreset = async () => {
  const target = presetPendingDelete.value;
  if (!target) return;

  let nextPresets: FFmpegPreset[];

  if (hasTauri()) {
    try {
      // Keep backend presets in sync so Smart Scan and queued jobs never see
      // a stale preset id that no longer exists.
      nextPresets = await deletePresetOnBackend(target.id);
    } catch (error) {
      console.error("Failed to delete preset on backend, falling back to local state", error);
      nextPresets = presets.value.filter((p) => p.id !== target.id);
    }
  } else {
    nextPresets = presets.value.filter((p) => p.id !== target.id);
  }

  presets.value = nextPresets;

  // 如果当前智能扫描默认预设被删掉，回退到第一个或清空
  if (smartConfig.value.videoPresetId === target.id) {
    smartConfig.value.videoPresetId = presets.value[0]?.id ?? "";
  }

  presetPendingDelete.value = null;
};

const cancelDeletePreset = () => {
  presetPendingDelete.value = null;
};

const refreshToolStatuses = async () => {
  if (!hasTauri()) return;
  try {
    toolStatuses.value = await fetchExternalToolStatuses();
  } catch (error) {
    console.error("Failed to load external tool statuses", error);
  }
};

const handleSaveSettings = async () => {
  if (!appSettings.value || !hasTauri()) return;
  try {
    appSettings.value = await saveAppSettings(appSettings.value);
    await refreshToolStatuses();
  } catch (error) {
    console.error("Failed to save settings", error);
  }
};

const addManualJobMock = () => {
  const presetForJob = manualJobPreset.value ?? presets.value[0];
  if (!presetForJob) {
    return;
  }
  const size = Math.floor(Math.random() * 500) + 50;
  const newJob: TranscodeJob = {
    id: Date.now().toString(),
    filename: `manual_job_${Math.floor(Math.random() * 1000)}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: size,
    originalCodec: "h264",
    presetId: presetForJob.id,
    status: "waiting",
    progress: 0,
    logs: [],
  };
  jobs.value = [newJob, ...jobs.value];
  activeTab.value = "queue";
};

const enqueueManualJobFromPath = async (path: string) => {
  const preset = manualJobPreset.value ?? presets.value[0];
  if (!preset) {
    console.error("No preset available for manual job");
    queueError.value =
      (t("queue.error.enqueueFailed") as string) ||
      "无法将任务加入队列：当前没有可用的预设，请先在“预设管理”中创建至少一个预设。";
    return;
  }

  try {
    // Let the backend compute accurate size and codec; we only provide the path and preset.
    await enqueueTranscodeJob({
      filename: path,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0,
      originalCodec: undefined,
      presetId: preset.id,
    });

    // 避免和队列流事件同时更新导致“先出现两个任务然后消失一个”，
    // 这里不再手工拼装前端队列，而是统一让后端状态成为单一真源。
    await refreshQueueFromBackend();
    queueError.value = null;
  } catch (error) {
    console.error("Failed to enqueue manual job from path", error);
    queueError.value =
      (t("queue.error.enqueueFailed") as string) ||
      "无法将任务加入队列，可能是外部工具未准备好或自动下载失败。请检查“软件设置”中的外部工具配置。";
  }
};

const addManualJob = async () => {
  activeTab.value = "queue";

  // In pure web mode we keep the mock behaviour so the UI remains usable.
  if (!hasTauri()) {
    addManualJobMock();
    return;
  }

  try {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Video",
          extensions: EXTENSIONS.videos.map((ext) => ext.replace(/^\./, "")),
        },
      ],
    });

    if (!selected) {
      // User cancelled the dialog; do not treat as an error.
      return;
    }

    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path || typeof path !== "string") {
      console.error("Dialog returned an invalid path for manual job", selected);
      queueError.value =
        (t("queue.error.enqueueFailed") as string) ||
        "无法将任务加入队列：系统对话框未返回有效路径，请重试或改用拖拽或左侧的“添加压缩任务（智能扫描）”。";
      return;
    }

    await enqueueManualJobFromPath(path);
  } catch (error) {
    console.error("Failed to open dialog for manual job", error);
    queueError.value =
      (t("queue.error.enqueueFailed") as string) ||
      "无法调用系统文件选择对话框，请检查 Tauri 权限配置或稍后重试。";
  }
};

const handleFileInputChange = async (event: Event) => {
  const input = (event.target as HTMLInputElement | null) ?? fileInputRef.value;
  const file = input?.files?.[0];
  if (!file) return;

  const anyFile = file as any;
  const path: string | undefined = anyFile?.path;

  // 在纯 Web 环境下，直接走前端模拟逻辑，保持可用性。
  if (!hasTauri()) {
    addManualJobMock();
    if (input) {
      input.value = "";
    }
    return;
  }

  // 在 Tauri 环境里，如果拿不到本地路径，就不要再伪造一个前端任务，
  // 否则会被后端轮询马上覆盖掉，看起来像“任务一闪而过/完全没反应”。
  if (!path || typeof path !== "string") {
    console.error(
      "Selected file does not expose a native path in Tauri; cannot enqueue backend job from file input",
    );
    queueError.value =
      (t("queue.error.enqueueFailed") as string) ||
      "无法将任务加入队列：当前环境未提供本地文件路径，请改用拖拽或左侧的“添加压缩任务（智能扫描）”入口。";
    if (input) {
      input.value = "";
    }
    return;
  }

  await enqueueManualJobFromPath(path);

  if (input) {
    input.value = "";
  }
};

const handleFolderInputChange = (event: Event) => {
  const input = (event.target as HTMLInputElement | null) ?? folderInputRef.value;
  const files = input?.files;

  if (!files || files.length === 0) {
    if (input) {
      input.value = "";
    }
    pendingSmartScanAfterFolder.value = false;
    return;
  }

  const first = files[0] as any;
  const rawPath: string | undefined = first?.path;

  if (hasTauri() && rawPath && typeof rawPath === "string") {
    const normalized = rawPath.replace(/\\/g, "/");
    const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    lastDroppedRoot.value = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized;
  } else {
    console.error("Selected folder does not expose a native path; ignoring selection");
  }

  if (pendingSmartScanAfterFolder.value && lastDroppedRoot.value) {
    showSmartScan.value = true;
  }

  pendingSmartScanAfterFolder.value = false;

  if (input) {
    input.value = "";
  }
};

const handleCancelJob = async (jobId: string) => {
  if (!jobId) return;

  if (!hasTauri()) {
    jobs.value = jobs.value.map((job) =>
      job.id === jobId &&
      (job.status === "waiting" || job.status === "processing")
        ? {
            ...job,
            status: "cancelled" as JobStatus,
            logs: [...job.logs, "Cancelled in simulated mode"],
          }
        : job,
    );
    return;
  }

  try {
    const ok = await cancelTranscodeJob(jobId);
    if (!ok) {
      queueError.value =
        (t("queue.error.cancelRejected") as string) ||
        "后台拒绝取消该任务，可能已经完成或处于不可取消状态。";
      return;
    }

    jobs.value = jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      if (job.status === "waiting" || job.status === "queued") {
        return { ...job, status: "cancelled" as JobStatus };
      }
      if (job.status === "processing") {
        return {
          ...job,
          status: "cancelled" as JobStatus,
          logs: [
            ...job.logs,
            "Cancellation requested from UI; waiting for backend to stop ffmpeg",
          ],
        };
      }
      return job;
    });
    queueError.value = null;
  } catch (error) {
    console.error("Failed to cancel job", error);
    queueError.value =
      (t("queue.error.cancelFailed") as string) ||
      "取消任务时出现错误，可能与外部工具或后端状态有关。请稍后重试或检查设置。";
  }
};

const runSmartScanMock = (config: SmartScanConfig) => {
  smartConfig.value = { ...config };
  showSmartScan.value = false;
  activeTab.value = "queue";

  const found: TranscodeJob[] = [];
  const count = 5 + Math.floor(Math.random() * 5);
  const batchId = `mock-batch-${Date.now().toString(36)}`;

  for (let i = 0; i < count; i += 1) {
    const isVideo = Math.random() > 0.4;
    let filename = "";
    let size = 0;
    let codec = "";
    let status: JobStatus = "waiting";
    let skipReason = "";

    if (isVideo) {
      const ext = EXTENSIONS.videos[Math.floor(Math.random() * EXTENSIONS.videos.length)];
      filename = `video_scanned_${Math.floor(Math.random() * 1000)}${ext}`;
      size = 10 + Math.random() * 200;
      codec = Math.random() > 0.7 ? "hevc" : "h264";

      if (codec === "hevc" || codec === "av1") {
        status = "skipped";
        skipReason = `Codec is already ${codec}`;
      } else if (size < config.minVideoSizeMB) {
        status = "skipped";
        skipReason = `Size < ${config.minVideoSizeMB}MB`;
      }
    } else {
      const ext = EXTENSIONS.images[Math.floor(Math.random() * EXTENSIONS.images.length)];
      const isAvif = Math.random() > 0.9;
      filename = `photo_scan_${Math.floor(Math.random() * 1000)}${isAvif ? ".avif" : ext}`;
      size = (10 + Math.random() * 5000) / 1024;
      codec = isAvif ? "avif" : "jpeg";

      if (filename.endsWith(".avif")) {
        status = "skipped";
        skipReason = "Already AVIF";
      } else if (size * 1024 < config.minImageSizeKB) {
        status = "skipped";
        skipReason = `Size < ${config.minImageSizeKB}KB`;
      }
    }

    found.push({
      id: `${Date.now().toString()}-${i}`,
      filename,
      type: isVideo ? "video" : "image",
      source: "smart_scan",
      originalSizeMB: size,
      originalCodec: codec,
      presetId: config.videoPresetId,
      status,
      progress: 0,
      logs: [],
      skipReason,
      batchId,
    });
  }

  smartScanBatchMeta.value = {
    ...smartScanBatchMeta.value,
    [batchId]: {
      rootPath: "",
      totalFilesScanned: found.length,
      totalCandidates: found.length,
      totalProcessed: found.filter((j) => j.status === "completed").length,
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
    },
  };

  jobs.value = [...found, ...jobs.value];
};

const runSmartScan = async (config: SmartScanConfig) => {
  smartConfig.value = { ...config };
  showSmartScan.value = false;
  activeTab.value = "queue";

  if (!hasTauri()) {
    runSmartScanMock(config);
    return;
  }

  const root = lastDroppedRoot.value;
  if (root) {
    try {
      const result = await runAutoCompress(root, config);
      const batchId = result.batchId;
      const normalizedJobs = (result.jobs ?? []).map((job) => ({
        ...job,
        batchId: job.batchId ?? batchId,
      }));

      applySmartScanBatchMetaSnapshot({
        batchId,
        rootPath: result.rootPath,
        totalFilesScanned: result.totalFilesScanned,
        totalCandidates: result.totalCandidates,
        totalProcessed: result.totalProcessed,
        startedAtMs: result.startedAtMs,
        completedAtMs: result.completedAtMs,
      });

      smartScanJobs.value = [...normalizedJobs, ...smartScanJobs.value];
      const existingBackendJobs = jobs.value.filter((job) => job.source === "manual");
      recomputeJobsFromBackend(existingBackendJobs);
      queueError.value = null;
      return;
    } catch (error) {
      console.error("auto-compress failed with dropped root", error);
      queueError.value =
        (t("queue.error.autoCompressFailed") as string) ||
        "智能压缩调用后端失败，已回退到前端模拟结果。请检查外部工具是否可用，或在“软件设置”中启用自动下载。";
    }
  }

  // 后端路径模式失败时，退回到纯前端模拟逻辑，保证不会完全无响应。
  runSmartScanMock(config);
};

const startSmartScan = async () => {
  activeTab.value = "queue";

  // In pure web mode we keep the existing behaviour.
  if (!hasTauri()) {
    showSmartScan.value = true;
    return;
  }

  // If we already know a root path from drag & drop or a previous selection,
  // just open the Smart Scan wizard directly.
  if (lastDroppedRoot.value) {
    showSmartScan.value = true;
    return;
  }

  // 在 Tauri 环境下，使用原生目录选择对话框获取根路径，避免 WebView 把
  // `webkitdirectory` 看成“向站点上传整个文件夹”而弹出隐私提示。
  try {
    const selected = await openDialog({
      multiple: false,
      directory: true,
    });

    if (!selected) {
      // 用户取消选择时保持静默，不弹错误。
      return;
    }

    const root = Array.isArray(selected) ? selected[0] : selected;
    if (!root || typeof root !== "string") {
      console.error("Dialog returned an invalid root path for Smart Scan", selected);
      showSmartScan.value = true;
      return;
    }

    lastDroppedRoot.value = root;
    showSmartScan.value = true;
  } catch (error) {
    console.error("Failed to open directory dialog for Smart Scan", error);
    // 回退到直接打开向导，由用户手动输入或改用拖拽。
    showSmartScan.value = true;
  }
};

const handlePathsDroppedOntoQueue = async (paths: string[]) => {
  const normalized = (paths || []).filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (normalized.length === 0) return;

  // 记录最近一次拖拽的根目录，供后续“智能扫描”默认使用。
  const first = normalized[0].replace(/\\/g, "/");
  const lastSlash = first.lastIndexOf("/");
  lastDroppedRoot.value = lastSlash >= 0 ? first.slice(0, lastSlash) : first;

  // 纯 Web 环境：保持原有“可用即可”的模拟行为。
  if (!hasTauri()) {
    addManualJobMock();
    return;
  }

  // 只对视频扩展名做队列任务，其他丢弃。
  const videoExts = EXTENSIONS.videos.map((ext) => ext.toLowerCase());
  const videoPaths = normalized.filter((p) => {
    const lower = p.toLowerCase();
    return videoExts.some((ext) => lower.endsWith(ext));
  });

  if (videoPaths.length === 0) {
    return;
  }

  for (const path of videoPaths) {
    // 顺序逐个入队，避免并发修改 jobs 产生竞态。
    // 失败会在 enqueueManualJobFromPath 内部写 queueError。
    // eslint-disable-next-line no-await-in-loop
    await enqueueManualJobFromPath(path);
  }
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  // 只有在队列页才展示拖拽覆盖层，其它标签页拖拽不做特殊处理。
  if (activeTab.value === "queue") {
    isDragging.value = true;
  }
};

const handleDragLeave = () => {
  isDragging.value = false;
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  isDragging.value = false;

  // 真正的桌面应用由 Tauri 的 onDragDropEvent 提供路径和拖拽生命周期，
  // 这里的 DOM drop 主要用于纯 Web 预览环境。
  if (hasTauri() || activeTab.value !== "queue") {
    return;
  }

  const dt = event.dataTransfer;
  if (!dt?.files || dt.files.length === 0) return;

  const rawPaths: string[] = [];
  for (const file of Array.from(dt.files)) {
    const anyFile = file as any;
    if (anyFile?.path && typeof anyFile.path === "string") {
      rawPaths.push(anyFile.path);
    }
  }

  void handlePathsDroppedOntoQueue(rawPaths);
};

const handleTauriFileDropHover = (paths: string[]) => {
  if (activeTab.value !== "queue") return;
  // Only show the overlay when at least one dropped path looks like a media file.
  const lowerPaths = paths.map((p) => p.toLowerCase());
  const allExts = [...EXTENSIONS.videos, ...EXTENSIONS.images].map((ext) => ext.toLowerCase());
  const hasMedia = lowerPaths.some((p) => allExts.some((ext) => p.endsWith(ext)));
  if (hasMedia) {
    isDragging.value = true;
  }
};

const handleTauriFileDrop = (paths: string[]) => {
  isDragging.value = false;
  if (activeTab.value !== "queue" || !paths || paths.length === 0) return;

  void handlePathsDroppedOntoQueue(paths);
};

const minimizeWindow = () => {
  if (!appWindow.value) return;
  void appWindow.value.minimize();
};

const toggleMaximizeWindow = () => {
  if (!appWindow.value) return;
  void appWindow.value.toggleMaximize();
};

const closeWindow = () => {
  if (!appWindow.value) return;
  void appWindow.value.close();
};

const ensurePresetsLoaded = async () => {
  if (!hasTauri()) return;
  if (presetsLoadedFromBackend.value) return;

  try {
    const loaded = await loadPresets();
    if (Array.isArray(loaded) && loaded.length > 0) {
      presets.value = loaded;
    }
    presetsLoadedFromBackend.value = true;
  } catch (error) {
    console.error("Failed to load presets from backend", error);
  }
};

const ensureAppSettingsLoaded = async () => {
  if (!hasTauri()) return;
  if (appSettings.value) return;
  try {
    const settings = await loadAppSettings();
    appSettings.value = settings;
    if (settings?.smartScanDefaults) {
      smartConfig.value = { ...settings.smartScanDefaults };
    }
  } catch (error) {
    console.error("Failed to load app settings", error);
  }
};

onMounted(() => {
  if (canUseTauriWindow()) {
    appWindow.value = getCurrentWindow();
    if (appWindow.value) {
      // Show the main window only after Vue has mounted to avoid a long blank window.
      void appWindow.value.show();
    }
  }
  if (!hasTauri()) {
    // In non-Tauri environments keep the existing simulated queue so the UI remains interactive.
    jobTimer = window.setInterval(() => {
      const currentJobs = jobs.value;
      if (currentJobs.length === 0) {
        return;
      }

      let hasChanges = false;
      let nextJobs = [...currentJobs];

      const activeCount = currentJobs.filter((j) => j.status === "processing").length;
      const waitingJobs = currentJobs.filter((j) => j.status === "waiting");

      if (activeCount < MAX_CONCURRENT_JOBS && waitingJobs.length > 0) {
        const slots = MAX_CONCURRENT_JOBS - activeCount;
        for (let i = 0; i < slots && i < waitingJobs.length; i += 1) {
          const jobToStart = waitingJobs[i];
          const idx = nextJobs.findIndex((j) => j.id === jobToStart.id);
          if (idx !== -1) {
            nextJobs[idx] = { ...nextJobs[idx], status: "processing", startTime: Date.now() };
            hasChanges = true;
          }
        }
      }

      nextJobs = nextJobs.map((job) => {
        if (job.status === "processing") {
          hasChanges = true;
          const newProgress = Math.min(job.progress + Math.random() * 8, 100);

          if (newProgress >= 100) {
            const preset = presets.value.find((p) => p.id === job.presetId);
            let efficiency = 0.5;

            if (job.type === "video") {
              if (preset?.video.encoder === "libx264") efficiency = preset.video.qualityValue / 51;
              if (preset?.video.encoder === "hevc_nvenc") efficiency =
                ((preset?.video.qualityValue ?? 28) / 51) * 0.9;
              if (preset?.video.encoder === "libsvtav1") efficiency =
                ((preset?.video.qualityValue ?? 34) / 63) * 0.7;
            } else {
              efficiency = smartConfig.value.imageTargetFormat === "avif" ? 0.3 : 0.6;
            }

            const actualEfficiency = efficiency * (0.8 + Math.random() * 0.4);
            const outputSize = job.originalSizeMB * actualEfficiency;
            const duration = (Date.now() - (job.startTime ?? Date.now())) / 1000;
            const savingsRatio = outputSize / job.originalSizeMB;

            if (job.source === "smart_scan") {
              const isWorthKeeping = savingsRatio <= smartConfig.value.minSavingRatio;
              if (!isWorthKeeping) {
                return {
                  ...job,
                  status: "skipped" as JobStatus,
                  progress: 100,
                  endTime: Date.now(),
                  skipReason: `Low savings (${(savingsRatio * 100).toFixed(1)}%)`,
                };
              }
            }

            if (job.type === "video") {
              updatePresetStats(job.presetId, job.originalSizeMB, outputSize, duration);
            }

            return {
              ...job,
              status: "completed" as JobStatus,
              progress: 100,
              outputSizeMB: outputSize,
              endTime: Date.now(),
            };
          }

          return { ...job, progress: newProgress };
        }
        return job;
      });

      if (hasChanges) {
        jobs.value = nextJobs;
      }
    }, 500);
    return;
  }

  // 在 Tauri 模式下，尽早从后端拉取实际预设集合，保证参数预设和后台转码引擎使用同一份列表。
  void ensurePresetsLoaded();

  // In Tauri mode, prefer a push-based queue stream over polling.
  void (async () => {
    await refreshQueueFromBackend();
    try {
      queueUnlisten = await listen<QueueState>("transcoding://queue-state", (event) => {
        const payload = event.payload;
        if (!payload || !Array.isArray((payload as QueueState).jobs)) {
          return;
        }
        const state = payload as QueueState;
        applyQueueStateFromBackend(state);
      });
    } catch (error) {
      console.error(
        "Failed to register Tauri queue-state listener, falling back to polling",
        error,
      );
      queueTimer = window.setInterval(() => {
        void refreshQueueFromBackend();
      }, 1000);
    }
  })();

  // In Tauri mode, listen for Smart Scan progress snapshots so the queue can
  // show coarse-grained scanning progress while `run_auto_compress` is still
  // running on the backend.
  void (async () => {
    try {
      smartScanProgressUnlisten = await listen<AutoCompressProgress>(
        "auto-compress://progress",
        (event) => {
          const payload = event.payload as AutoCompressProgress | null;
          if (!payload || !payload.batchId) return;
          applySmartScanBatchMetaSnapshot({
            batchId: payload.batchId,
            rootPath: payload.rootPath,
            totalFilesScanned: payload.totalFilesScanned,
            totalCandidates: payload.totalCandidates,
            totalProcessed: payload.totalProcessed,
          });
        },
      );
    } catch (error) {
      console.error("Failed to register Smart Scan progress listener", error);
    }
  })();

  // In Tauri mode, also listen for OS-level drag & drop events so dragging files
  // from Explorer/Finder shows the overlay and triggers Smart Scan. On Tauri 2
  // this uses the higher-level onDragDropEvent helper instead of legacy
  // `tauri://file-drop-*` events, which no longer fire.
  if (hasTauri() && appWindow.value?.onDragDropEvent) {
    void (async () => {
      try {
        dragDropUnlisten = await appWindow.value!.onDragDropEvent((event: any) => {
          const payload = event.payload;
          if (!payload || typeof payload.type !== "string") return;

          if (payload.type === "enter") {
            const paths: string[] = Array.isArray(payload.paths) ? payload.paths : [];
            handleTauriFileDropHover(paths);
          } else if (payload.type === "drop") {
            const paths: string[] = Array.isArray(payload.paths) ? payload.paths : [];
            handleTauriFileDrop(paths);
          } else if (payload.type === "leave") {
            isDragging.value = false;
          }
        });
      } catch (error) {
        console.error("Failed to register Tauri drag & drop listener", error);
      }
    })();
  }
});

// Lazily load monitoring data and external tool statuses only when the
// corresponding tabs are opened, instead of doing all probes during startup.
watch(
  activeTab,
  (tab) => {
    if (tab === "monitor" && hasTauri()) {
      // Ensure we have at least one fresh snapshot when entering the monitor tab.
      if (!cpuSnapshot.value || !gpuSnapshot.value) {
        void (async () => {
          try {
            const [cpu, gpu] = await Promise.all([fetchCpuUsage(), fetchGpuUsage()]);
            cpuSnapshot.value = cpu;
            gpuSnapshot.value = gpu;
          } catch (error) {
            console.error("Failed to load monitoring data", error);
          }
        })();
      }

      if (monitorTimer === undefined) {
        monitorTimer = window.setInterval(async () => {
          try {
            const [cpu, gpu] = await Promise.all([fetchCpuUsage(), fetchGpuUsage()]);
            cpuSnapshot.value = cpu;
            gpuSnapshot.value = gpu;
          } catch (error) {
            console.error("Failed to refresh monitoring data", error);
          }
        }, 3000);
      }
    } else if (tab !== "monitor" && monitorTimer !== undefined) {
      window.clearInterval(monitorTimer);
      monitorTimer = undefined;
    }

    if (tab === "settings" && hasTauri()) {
      void ensureAppSettingsLoaded();
      if (toolStatuses.value.length === 0) {
        void refreshToolStatuses();
      }
    }
  },
  { flush: "post" },
);

watch(
  showSmartScan,
  (open) => {
    if (open && hasTauri()) {
      void ensureAppSettingsLoaded();
    }
  },
  { flush: "post" },
);

// Expose minimal helpers for tests that need to drive queue updates directly.
defineExpose({
  applyQueueStateFromBackend,
});

onUnmounted(() => {
  if (jobTimer !== undefined) {
    window.clearInterval(jobTimer);
    jobTimer = undefined;
  }
  if (queueTimer !== undefined) {
    window.clearInterval(queueTimer);
    queueTimer = undefined;
  }
  if (monitorTimer !== undefined) {
    window.clearInterval(monitorTimer);
    monitorTimer = undefined;
  }

  if (queueUnlisten) {
    queueUnlisten();
    queueUnlisten = null;
  }

  if (smartScanProgressUnlisten) {
    smartScanProgressUnlisten();
    smartScanProgressUnlisten = null;
  }

  if (dragDropUnlisten) {
    dragDropUnlisten();
    dragDropUnlisten = null;
  }
});
</script>

<template>
  <div
    class="h-full w-full bg-background text-foreground font-sans flex flex-col relative overflow-hidden"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <div
      v-if="isDragging"
      class="absolute inset-0 m-4 rounded-xl border-4 border-dashed border-blue-500 bg-blue-600/20 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      <div class="text-center pointer-events-none">
        <div
          class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-blue-400/70 bg-blue-500/15"
        >
          <span class="text-[10px] font-semibold tracking-[0.2em] uppercase text-blue-200">Drop</span>
        </div>
        <h2 class="text-2xl font-semibold text-white">Drop files to enqueue</h2>
        <p class="mt-1 text-sm text-blue-200">Release to create manual jobs in the queue</p>
        <p class="mt-2 text-xs text-blue-100 max-w-xl mx-auto">
          提示：也可以使用左侧的“添加压缩任务（智能扫描）”按钮，对整个目录做批量分析和压缩。
        </p>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      class="hidden"
      :accept="EXTENSIONS.videos.join(',')"
      data-tauri-drag-region="false"
      @change="handleFileInputChange"
    />
    <input
      ref="folderInputRef"
      type="file"
      webkitdirectory
      class="hidden"
      data-tauri-drag-region="false"
      @change="handleFolderInputChange"
    />

    <header
      data-tauri-drag-region
      class="flex items-center justify-between h-10 px-4 border-b border-border bg-secondary/90 backdrop-blur-sm select-none"
    >
      <div
        class="flex items-center gap-3 h-full text-sm font-semibold tracking-wide text-sidebar-foreground/90"
      >
        <span class="inline-flex h-4 w-4 rounded-full bg-primary/80" />
        <span class="truncate">
          {{ t("app.title") }}
        </span>
      </div>
      <div class="flex items-center gap-3" data-tauri-drag-region="false">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Select v-model="currentLocale">
            <SelectTrigger
              class="h-7 px-3 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">
                {{ t("app.lang.zh") }}
              </SelectItem>
              <SelectItem value="en">
                {{ t("app.lang.en") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border-border/70 bg-card/70 text-foreground hover:bg-card/90"
          title="Minimize"
          @click="minimizeWindow"
        >
          <span class="text-sm">─</span>
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border-border/70 bg-card/70 text-foreground hover:bg-card/90"
          title="Maximize"
          @click="toggleMaximizeWindow"
        >
          <span class="text-xs">▢</span>
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border border-destructive/70 bg-destructive/80 text-destructive-foreground hover:bg-destructive"
          title="Close"
          @click="closeWindow"
        >
          <span class="text-sm font-semibold">✕</span>
        </Button>
      </div>
    </header>

    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">

      <aside class="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div class="shrink-0 px-5 py-4 border-b border-sidebar-border flex items-center gap-3">
          <div
            class="h-8 w-8 rounded-md border border-sidebar-ring bg-sidebar-accent flex items-center justify-center text-[10px] font-semibold tracking-[0.15em] text-sidebar-primary uppercase"
          >
            FF
          </div>
          <div class="space-y-0.5">
            <h1 class="font-semibold text-sm text-sidebar-foreground leading-none">
              {{ t("app.controlPanel") }}
            </h1>
            <Badge
              variant="outline"
              class="text-[10px] px-1.5 py-0 border-sidebar-border text-sidebar-foreground/70 uppercase tracking-wide"
            >
              {{ t("app.controlPanel") }}
            </Badge>
          </div>
        </div>

        <nav class="flex-1 px-3 py-4 space-y-2">
          <Button
            variant="ghost"
            class="w-full justify-between px-4 h-11 rounded-lg text-sm font-medium"
            :class="
              activeTab === 'queue'
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            "
            @click="activeTab = 'queue'"
          >
            <span>{{ t("app.tabs.queue") }}</span>
            <span
              v-if="jobs.filter((j) => j.status === 'processing').length > 0"
              class="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
            />
          </Button>
          <Button
            variant="ghost"
            class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
            :class="
              activeTab === 'presets'
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            "
            @click="activeTab = 'presets'"
          >
            <span>{{ t("app.tabs.presets") }}</span>
          </Button>
          <Button
            variant="ghost"
            class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
            :class="
              activeTab === 'media'
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            "
            @click="activeTab = 'media'"
          >
            <span>{{ t("app.tabs.media") }}</span>
          </Button>
          <Button
            variant="ghost"
            class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
            :class="
              activeTab === 'monitor'
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            "
            @click="activeTab = 'monitor'"
          >
            <span>{{ t("app.tabs.monitor") }}</span>
          </Button>
          <Button
            variant="ghost"
            class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
            :class="
              activeTab === 'settings'
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            "
            @click="activeTab = 'settings'"
          >
            <span>{{ t("app.tabs.settings") }}</span>
          </Button>
        </nav>

        <div class="shrink-0 px-4 py-4 border-t border-sidebar-border space-y-3">
          <Button
            variant="default"
            size="lg"
            class="w-full justify-center"
            @click="addManualJob"
          >
            <span>{{ t("app.actions.addJob") }}</span>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            class="w-full justify-center"
            @click="startSmartScan"
          >
            <span>{{ t("app.actions.smartScan") }}</span>
          </Button>
        </div>
      </aside>

      <main class="flex-1 flex min-h-0 flex-col bg-background">
      <header
        class="shrink-0 px-4 py-2 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between gap-2"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-3 min-h-8">
            <h2 class="text-xl font-semibold tracking-tight text-foreground">
              {{ currentTitle }}
            </h2>
            <span
              v-if="activeTab === 'queue' && jobs.length > 0"
              class="bg-muted text-xs text-muted-foreground px-2 py-1 rounded-full"
            >
              {{ jobs.filter((j) => j.status === "completed").length }} / {{ jobs.length }}
            </span>
          </div>
          <p class="text-xs text-muted-foreground min-h-[1.25rem]">
            {{ currentSubtitle }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <div
            v-if="presets.length > 0"
            class="hidden sm:flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span>
              {{ t("app.queueDefaultPresetLabel") }}
            </span>
            <Select v-model="manualJobPresetId">
              <SelectTrigger
                class="h-7 px-3 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[160px]"
              >
                <SelectValue :placeholder="t('app.queueDefaultPresetPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="preset in presets"
                  :key="preset.id"
                  :value="preset.id"
                >
                  {{ preset.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            class="text-sm font-medium flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            :class="activeTab === 'presets' ? '' : 'opacity-0 pointer-events-none'"
            @click="openNewPresetWizard"
          >
            <span>＋</span>
            <span>{{ t("app.newPreset") }}</span>
          </Button>
        </div>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div class="pb-8">
            <section v-if="activeTab === 'queue'" class="space-y-4 max-w-4xl mx-auto">
              <div
                v-if="queueError"
                class="mb-4 border border-destructive/60 bg-destructive/10 text-destructive text-xs rounded-md px-3 py-2 flex items-start gap-2"
              >
                <span class="mt-0.5">!</span>
                <span>{{ queueError }}</span>
              </div>
              <div
                v-if="jobs.length === 0"
                class="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-sidebar-ring/70 hover:text-foreground transition-all"
                @click="addManualJob"
              >
                <div
                  class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card/70"
                >
                  <span class="text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                    {{ t("app.tabs.queue") }}
                  </span>
                </div>
                <p class="text-lg font-medium">
                  {{ t("app.emptyQueue.title") }}
                </p>
                <p class="text-sm text-muted-foreground">
                  {{ t("app.emptyQueue.subtitle") }}
                </p>
              </div>
              <div v-else>
                <div
                  v-for="item in visibleQueueItems"
                  :key="item.kind === 'batch' ? item.batch.batchId : item.job.id"
                  class="mb-3"
                >
                  <Card
                    v-if="item.kind === 'batch'"
                    data-testid="smart-scan-batch-card"
                    class="border-border/70 bg-card/90 shadow-sm hover:border-primary/40 transition-colors"
                  >
                    <CardHeader
                      class="pb-2 flex flex-row items-start justify-between gap-3 cursor-pointer"
                      @click="toggleBatchExpanded(item.batch.batchId)"
                    >
                      <div class="space-y-1">
                        <div class="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-300"
                          >
                            {{ t("queue.source.smartScan") }}
                          </Badge>
                          <span class="text-xs text-muted-foreground">
                            {{ item.batch.totalProcessed }} / {{ item.batch.totalCandidates }}
                          </span>
                        </div>
                        <CardTitle class="text-sm font-semibold truncate max-w-lg">
                          {{ item.batch.rootPath || t("smartScan.title") }}
                        </CardTitle>
                        <CardDescription class="text-xs text-muted-foreground">
                          <span v-if="item.batch.currentJob">
                            {{ item.batch.currentJob.filename }}
                          </span>
                          <span v-else>
                            {{ t("smartScan.subtitle") }}
                          </span>
                        </CardDescription>
                      </div>
                      <div class="flex flex-col items-end gap-1">
                        <span class="text-xs font-mono text-muted-foreground">
                          {{ Math.round(item.batch.overallProgress) }}%
                        </span>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          class="h-6 w-6 rounded-full border-border/60 bg-muted/40 text-xs"
                          @click.stop="toggleBatchExpanded(item.batch.batchId)"
                        >
                          <span v-if="isBatchExpanded(item.batch.batchId)">−</span>
                          <span v-else>＋</span>
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent class="pt-0 pb-3 space-y-2">
                      <Progress :model-value="item.batch.overallProgress" />
                      <div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span>
                          {{ t("queue.typeVideo") }} / {{ t("queue.typeImage") }}:
                          {{
                            item.batch.jobs.filter((j) => j.type === "video").length
                          }}
                          /
                          {{
                            item.batch.jobs.filter((j) => j.type === "image").length
                          }}
                        </span>
                        <span>
                          {{ t("queue.status.completed") }}:
                          {{ item.batch.completedCount }}
                        </span>
                        <span v-if="item.batch.skippedCount > 0">
                          {{ t("queue.status.skipped") }}:
                          {{ item.batch.skippedCount }}
                        </span>
                        <span v-if="item.batch.failedCount > 0">
                          {{ t("queue.status.failed") }}:
                          {{ item.batch.failedCount }}
                        </span>
                      </div>
                      <div
                        v-if="isBatchExpanded(item.batch.batchId)"
                        data-testid="smart-scan-batch-children"
                        class="mt-2 space-y-2"
                      >
                        <QueueItem
                          v-for="child in item.batch.jobs"
                          :key="child.id"
                          :job="child"
                          :preset="presets.find((p) => p.id === child.presetId) ?? presets[0]"
                          :can-cancel="
                            hasTauri() &&
                            ['waiting', 'queued', 'processing'].includes(child.status)
                          "
                          @cancel="handleCancelJob"
                          @inspect="openJobDetail"
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <QueueItem
                    v-else
                    :job="item.job"
                    :preset="presets.find((p) => p.id === item.job.presetId) ?? presets[0]"
                    :can-cancel="
                      hasTauri() &&
                      ['waiting', 'queued', 'processing'].includes(item.job.status)
                    "
                    @cancel="handleCancelJob"
                    @inspect="openJobDetail"
                  />
                </div>
              </div>
            </section>

            <section v-else-if="activeTab === 'presets'" class="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
              <Card
                v-for="preset in presets"
                :key="preset.id"
                class="relative group overflow-hidden bg-card border border-border shadow-sm"
              >
                <CardHeader class="pb-3">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle class="text-base md:text-lg">
                        {{ preset.name }}
                      </CardTitle>
                      <CardDescription class="mt-1 h-10 line-clamp-2">
                        {{ preset.description }}
                      </CardDescription>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        class="h-7 px-3 text-[11px] rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                        @click="openEditPresetWizard(preset)"
                      >
                        <span>{{ t("presetEditor.actions.edit") }}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-3 text-[11px] rounded-full border border-destructive/50 bg-card/70 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                        @click="requestDeletePreset(preset)"
                      >
                        <span>{{ t("app.actions.deletePreset") }}</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="pt-0 pb-4">
                  <div class="grid grid-cols-2 gap-4 text-xs md:text-sm mb-4">
                    <div class="rounded-md border border-border/60 bg-muted/40 p-2">
                      <span class="block text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wide">
                        {{ t("presets.videoLabel") }}
                      </span>
                      <span class="text-primary font-mono text-xs">
                        {{ preset.video.encoder }}<br />
                        {{ preset.video.rateControl.toUpperCase() }}: {{ preset.video.qualityValue }}
                      </span>
                    </div>
                    <div class="rounded-md border border-border/60 bg-muted/40 p-2">
                      <span class="block text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wide">
                        {{ t("presets.audioLabel") }}
                      </span>
                      <span class="text-muted-foreground font-mono text-xs">
                        <span v-if="preset.audio.codec === 'copy'">
                          {{ t("presets.audioCopy") }}
                        </span>
                        <span v-else>
                          {{ t("presets.audioAac", { kbps: preset.audio.bitrate ?? 0 }) }}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div class="flex justify-between items-center text-[11px] text-muted-foreground">
                    <div>
                      {{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}
                    </div>
                    <div class="flex flex-wrap gap-3 justify-end text-right">
                      <span>
                        {{
                          t("presets.totalIn", {
                            gb: (preset.stats.totalInputSizeMB / 1024).toFixed(1),
                          })
                        }}
                      </span>
                      <span v-if="getPresetAvgRatio(preset) !== null">
                        {{
                          t("presets.avgRatio", {
                            percent: getPresetAvgRatio(preset)?.toFixed(1) ?? "0.0",
                          })
                        }}
                      </span>
                      <span v-if="getPresetAvgSpeed(preset) !== null">
                        {{
                          t("presets.avgSpeed", {
                            mbps: getPresetAvgSpeed(preset)?.toFixed(1) ?? "0.0",
                          })
                        }}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section v-else-if="activeTab === 'media'" class="max-w-4xl mx-auto py-12 text-sm text-muted-foreground">
              <p>媒体信息视图暂未实现，后续会在这里展示媒体元数据和详细分析。</p>
            </section>

            <section
              v-else-if="activeTab === 'monitor'"
              class="max-w-4xl mx-auto py-12 text-sm text-muted-foreground"
            >
              <div class="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle class="text-sm">CPU</CardTitle>
                  </CardHeader>
                  <CardContent class="text-xs space-y-2">
                    <p v-if="cpuSnapshot">
                      当前总使用率：
                      <span class="font-mono text-foreground">
                        {{ cpuSnapshot.overall.toFixed(1) }}%
                      </span>
                    </p>
                    <p v-else>等待从后端获取 CPU 使用率...</p>
                    <div
                      v-if="cpuSnapshot"
                      class="flex flex-wrap gap-1 mt-2"
                    >
                      <span
                        v-for="(core, idx) in cpuSnapshot.perCore"
                        :key="idx"
                        class="px-1.5 py-0.5 rounded bg-muted text-foreground/80 font-mono"
                      >
                        C{{ idx }}: {{ core.toFixed(0) }}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle class="text-sm">GPU (NVIDIA / NVML)</CardTitle>
                  </CardHeader>
                  <CardContent class="text-xs space-y-2">
                    <div v-if="gpuSnapshot">
                      <p v-if="gpuSnapshot.available">
                        GPU 使用率：
                        <span class="font-mono text-foreground">
                          {{ gpuSnapshot.gpuPercent ?? 0 }}%
                        </span>
                      </p>
                      <p v-if="gpuSnapshot.available && gpuSnapshot.memoryPercent !== undefined">
                        显存使用率：
                        <span class="font-mono text-foreground">
                          {{ gpuSnapshot.memoryPercent }}%
                        </span>
                      </p>
                      <p v-if="!gpuSnapshot.available">
                        {{ gpuSnapshot.error ?? "未检测到 NVIDIA GPU，或 NVML 不可用。" }}
                      </p>
                    </div>
                    <p v-else>等待从后端获取 GPU 使用率...</p>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section
              v-else-if="activeTab === 'settings'"
              class="max-w-4xl mx-auto py-12 text-sm text-muted-foreground"
            >
              <div class="space-y-8">
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <h3 class="text-sm font-semibold text-foreground">
                      外部工具状态
                    </h3>
                    <Button
                      v-if="hasTauri()"
                      size="sm"
                      variant="outline"
                      class="h-7 px-3 text-[11px]"
                      @click="refreshToolStatuses"
                    >
                      刷新状态
                    </Button>
                  </div>
                  <div class="space-y-2 text-xs">
                    <div
                      v-for="tool in toolStatuses"
                      :key="tool.kind"
                      class="flex items-center justify-between border border-border rounded px-2 py-1 bg-muted/40"
                    >
                      <span class="font-mono text-foreground/80">
                        {{ tool.kind }}
                      </span>
                      <div class="text-right space-y-0.5">
                        <p v-if="tool.resolvedPath" class="truncate max-w-xs text-foreground">
                          {{ tool.resolvedPath }}
                        </p>
                        <p v-else class="text-destructive text-xs">
                          未找到可用的可执行文件
                        </p>
                        <p v-if="tool.version" class="text-[10px] text-muted-foreground">
                          {{ tool.version }}
                        </p>
                        <div class="flex flex-wrap gap-2 justify-end text-[10px] text-muted-foreground">
                          <span>
                            自动下载：{{ tool.autoDownloadEnabled ? "已启用" : "关闭" }}
                          </span>
                          <span>
                            自动更新：{{ tool.autoUpdateEnabled ? "已启用" : "关闭" }}
                          </span>
                          <span
                            v-if="tool.updateAvailable"
                            class="text-amber-400"
                          >
                            检测到可用更新
                          </span>
                        </div>
                      </div>
                    </div>
                    <p class="text-[10px] text-muted-foreground">
                      当设置了自定义路径时优先使用自定义路径，否则从系统 PATH 查找。自动下载 /
                      自动更新选项会在需要时尝试获取或升级 ffmpeg、ffprobe 和 avifenc。
                    </p>
                  </div>
                </div>

                <div v-if="appSettings" class="space-y-4">
                  <h3 class="text-sm font-semibold text-foreground">
                    路径与下载设置
                  </h3>
                  <div class="grid gap-3 md:grid-cols-2 text-xs">
                    <div class="space-y-1">
                      <label class="block text-[11px] text-muted-foreground">FFmpeg 路径</label>
                      <Input
                        v-model="appSettings.tools.ffmpegPath"
                        class="h-8 text-xs"
                        placeholder="留空表示从 PATH 查找"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="block text-[11px] text-muted-foreground">ffprobe 路径</label>
                      <Input
                        v-model="appSettings.tools.ffprobePath"
                        class="h-8 text-xs"
                        placeholder="留空表示从 PATH 查找"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="block text-[11px] text-muted-foreground">avifenc 路径</label>
                      <Input
                        v-model="appSettings.tools.avifencPath"
                        class="h-8 text-xs"
                        placeholder="留空表示从 PATH 查找"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="block text-[11px] text-muted-foreground">自动下载 / 更新</label>
                      <div class="flex items-center gap-3">
                        <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                          <input
                            v-model="appSettings.tools.autoDownload"
                            type="checkbox"
                            class="h-3 w-3"
                          />
                          <span>允许自动下载</span>
                        </label>
                        <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                          <input
                            v-model="appSettings.tools.autoUpdate"
                            type="checkbox"
                            class="h-3 w-3"
                          />
                          <span>允许自动更新</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-3 text-xs">
                    <div class="space-y-1">
                      <label class="block text-[11px] text-muted-foreground">
                        预览截帧位置（%）
                      </label>
                      <div class="flex items-center gap-2">
                        <Input
                          v-model.number="appSettings.previewCapturePercent"
                          type="number"
                          min="0"
                          max="100"
                          class="h-8 w-24 text-xs"
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
                          v-model.number="appSettings.maxParallelJobs"
                          type="number"
                          min="0"
                          max="32"
                          class="h-8 w-24 text-xs"
                        />
                        <span class="text-[11px] text-muted-foreground">
                          0 表示自动（约为 CPU 逻辑核数的一半），&gt; 0 时将上限固定为该值。
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="flex justify-end">
                    <Button
                      size="sm"
                      class="px-4 h-8"
                      @click="handleSaveSettings"
                    >
                      保存设置
                    </Button>
                  </div>
                </div>

                <div v-else class="text-xs text-muted-foreground">
                  正在从后端加载应用设置...
                </div>
              </div>
            </section>
          </div>
      </div>
      </main>

    </div>

    <ParameterWizard
      v-if="showWizard"
      :initial-preset="editingPreset"
      @save="handleSavePreset"
      @switch-to-panel="openPresetPanelFromWizard"
      @cancel="() => { showWizard = false; editingPreset = null; }"
    />

    <UltimateParameterPanel
      v-if="showParameterPanel && editingPreset"
      :initial-preset="editingPreset"
      @save="handleSavePreset"
      @switch-to-wizard="openPresetWizardFromPanel"
      @cancel="
        () => {
          showParameterPanel = false;
          editingPreset = null;
        }
      "
    />

    <SmartScanWizard
      v-if="showSmartScan"
      :presets="presets"
      @start-scan="runSmartScan"
      @cancel="showSmartScan = false"
    />

    <Dialog
      :open="!!selectedJobForDetail"
      @update:open="(open) => { if (!open) closeJobDetail(); }"
    >
      <DialogScrollContent class="sm:max-w-3xl overflow-hidden p-0">
        <div class="flex max-h-[calc(100vh-4rem)] flex-col">
          <DialogHeader class="border-b border-border px-6 py-4 bg-card">
            <DialogTitle class="text-base">
              {{ t("taskDetail.title") }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-[11px] text-muted-foreground">
              {{ t("taskDetail.description") }}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea class="flex-1 bg-muted/30 px-6 py-4 text-xs">
            <div
              v-if="selectedJobForDetail"
              class="space-y-4"
            >
              <div
                class="relative overflow-hidden rounded-md border border-border bg-background"
                data-testid="task-detail-header"
              >
                <div
                  v-if="jobDetailPreviewUrl"
                  class="pointer-events-none absolute inset-0"
                  data-testid="task-detail-header-bg"
                >
                  <img
                    :src="jobDetailPreviewUrl"
                    alt=""
                    class="h-full w-full object-cover blur-sm scale-105"
                    @error="handlePreviewImageError"
                  />
                  <div class="absolute inset-0 bg-background/70" />
                </div>

                <div
                  class="relative flex flex-col gap-4 px-3 py-3 md:flex-row"
                >
                  <button
                    type="button"
                    class="group w-full md:w-60 aspect-video rounded-md border border-border bg-muted flex items-center justify-center overflow-hidden cursor-zoom-in"
                    data-testid="task-detail-preview"
                    @click.stop="openExpandedPreview"
                  >
                    <img
                      v-if="jobDetailPreviewUrl"
                      :src="jobDetailPreviewUrl"
                      alt=""
                      class="h-full w-full object-cover transition-transform group-hover:scale-105"
                      @error="handlePreviewImageError"
                    />
                    <span
                      v-else
                      class="text-[11px] text-muted-foreground"
                    >
                      {{ t("taskDetail.noPreview") }}
                    </span>
                  </button>

                  <div class="flex-1 space-y-2">
                    <div
                      data-testid="task-detail-title"
                      class="text-sm font-semibold text-foreground break-all"
                    >
                      {{ jobDetailTitle }}
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        class="text-[10px] uppercase"
                        :class="detailStatusBadgeClass"
                      >
                        {{ detailStatusLabel }}
                      </Badge>
                      <span class="text-[11px] text-muted-foreground">
                        {{ detailSourceLabel }}
                      </span>
                    </div>
                    <div class="space-y-1 text-[11px]">
                      <div
                        v-if="detailPresetLabel"
                        class="text-foreground"
                      >
                        {{ t("taskDetail.presetLabel") }}:
                        <span class="font-medium">
                          {{ detailPresetLabel }}
                        </span>
                        <span
                          v-if="detailPreset && detailPreset.description"
                          class="ml-1 text-muted-foreground"
                        >
                          — {{ detailPreset.description }}
                        </span>
                      </div>
                      <div
                        v-if="selectedJobForDetail.originalSizeMB"
                        class="text-foreground"
                      >
                        {{ t("taskDetail.sizeLabel") }}:
                        {{ selectedJobForDetail.originalSizeMB.toFixed(2) }} MB
                      </div>
                      <div
                        v-if="selectedJobForDetail.outputSizeMB"
                        class="text-foreground"
                      >
                        {{ t("taskDetail.outputSizeLabel") }}:
                        {{ selectedJobForDetail.outputSizeMB.toFixed(2) }} MB
                      </div>
                      <div
                        v-if="jobDetailDurationSeconds"
                        class="text-foreground"
                      >
                        {{ t("taskDetail.durationLabel") }}:
                        {{ jobDetailDurationSeconds && jobDetailDurationSeconds.toFixed(1) }} s
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <div
                  class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
                >
                  <h3 class="text-xs font-semibold">
                    {{ t("taskDetail.pathsTitle") }}
                  </h3>
                  <div class="space-y-1">
                    <div class="flex items-center gap-2">
                      <span class="shrink-0 text-[11px] text-muted-foreground">
                        {{ t("taskDetail.inputPath") }}:
                      </span>
                      <span
                        data-testid="task-detail-input-path"
                        class="flex-1 break-all text-foreground select-text"
                      >
                        {{ selectedJobForDetail.inputPath || selectedJobForDetail.filename }}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        class="h-6 w-6 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                        @click="copyToClipboard(selectedJobForDetail.inputPath || selectedJobForDetail.filename)"
                      >
                        ⧉
                      </Button>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="shrink-0 text-[11px] text-muted-foreground">
                        {{ t("taskDetail.outputPath") }}:
                      </span>
                      <span
                        data-testid="task-detail-output-path"
                        class="flex-1 break-all text-foreground select-text"
                      >
                        {{ selectedJobForDetail.outputPath || "-" }}
                      </span>
                      <Button
                        v-if="selectedJobForDetail.outputPath"
                        variant="outline"
                        size="icon-sm"
                        class="h-6 w-6 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                        @click="copyToClipboard(selectedJobForDetail.outputPath)"
                      >
                        ⧉
                      </Button>
                    </div>
                  </div>
                </div>

                <div
                  class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
                >
                  <h3 class="text-xs font-semibold">
                    {{ t("taskDetail.mediaInfoTitle") }}
                  </h3>
                  <div
                    v-if="selectedJobForDetail.mediaInfo"
                    class="grid grid-cols-2 gap-x-4 gap-y-1"
                  >
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("taskDetail.codecLabel") }}
                    </span>
                    <span class="text-foreground">
                      {{
                        selectedJobForDetail.mediaInfo?.videoCodec ||
                        selectedJobForDetail.originalCodec ||
                        "-"
                      }}
                    </span>
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("taskDetail.resolutionLabel") }}
                    </span>
                    <span class="text-foreground">
                      {{
                        selectedJobForDetail.mediaInfo?.width &&
                        selectedJobForDetail.mediaInfo?.height
                          ? `${selectedJobForDetail.mediaInfo.width}×${selectedJobForDetail.mediaInfo.height}`
                          : "-"
                      }}
                    </span>
                    <span class="text-[11px] text-muted-foreground">
                      {{ t("taskDetail.frameRateLabel") }}
                    </span>
                    <span class="text-foreground">
                      {{
                        selectedJobForDetail.mediaInfo?.frameRate
                          ? `${selectedJobForDetail.mediaInfo.frameRate.toFixed(2)} fps`
                          : "-"
                      }}
                    </span>
                  </div>
                  <div v-else class="text-[11px] text-muted-foreground">
                    {{ t("taskDetail.mediaInfoFallback") }}
                  </div>
                </div>
              </div>

              <div
                class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <h3 class="text-xs font-semibold">
                      {{ t("taskDetail.commandTitle") }}
                    </h3>
                    <button
                      v-if="jobDetailHasDistinctTemplate"
                      type="button"
                      class="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      @click="toggleCommandView"
                    >
                      {{ commandViewToggleLabel }}
                    </button>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      v-if="selectedJobForDetail.ffmpegCommand"
                      variant="outline"
                      size="xs"
                      class="h-6 px-2 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                      data-testid="task-detail-copy-command"
                      @click="copyToClipboard(jobDetailRawCommand)"
                    >
                      {{ t("taskDetail.copyCommand") }}
                    </Button>
                    <Button
                      v-if="jobDetailHasDistinctTemplate && selectedJobForDetail.ffmpegCommand"
                      variant="outline"
                      size="xs"
                      class="h-6 px-2 text-[10px] bg-secondary/40 text-foreground hover:bg-secondary"
                      data-testid="task-detail-copy-template-command"
                      @click="copyToClipboard(jobDetailTemplateCommand)"
                    >
                      复制模板
                    </Button>
                  </div>
                </div>
                <pre
                  v-if="selectedJobForDetail.ffmpegCommand"
                  class="max-h-32 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-foreground whitespace-pre-wrap select-text"
                  data-testid="task-detail-command"
                  v-html="highlightedCommandHtml"
                />
                <p v-else class="text-[11px] text-muted-foreground">
                  {{ t("taskDetail.commandFallback") }}
                </p>
              </div>

              <div
                v-if="jobDetailLogText"
                class="space-y-2 rounded-md border border-border bg-background px-3 py-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-xs font-semibold">
                    {{ t("taskDetail.logsTitle") }}
                  </h3>
                  <Button
                    variant="outline"
                    size="xs"
                    class="h-6 px-2 text-[10px] bg-secondary/70 text-foreground hover:bg-secondary"
                    data-testid="task-detail-copy-logs"
                    @click="copyToClipboard(jobDetailLogText)"
                  >
                    {{ t("taskDetail.copyLogs") }}
                  </Button>
                </div>
                <div
                  class="max-h-56 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-foreground whitespace-pre-wrap select-text"
                  data-testid="task-detail-logs"
                  v-html="highlightedLogHtml"
                />
                <p
                  v-if="selectedJobForDetail.status === 'failed' && selectedJobForDetail.failureReason"
                  class="text-[11px] text-destructive font-medium"
                >
                  {{ t("taskDetail.failureReasonPrefix") }}
                  {{ selectedJobForDetail.failureReason }}
                </p>
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog
      :open="expandedPreviewOpen"
      @update:open="(open) => { expandedPreviewOpen = open; if (!open) closeExpandedPreview(); }"
    >
      <DialogContent class="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle class="text-base">
            {{ jobDetailTitle || t("taskDetail.title") }}
          </DialogTitle>
          <DialogDescription class="mt-1 text-[11px] text-muted-foreground">
            {{ t("taskDetail.description") }}
          </DialogDescription>
        </DialogHeader>
        <div class="mt-2">
          <video
            v-if="expandedPreviewUrl"
            data-testid="task-detail-expanded-video"
            :src="expandedPreviewUrl"
            controls
            class="w-full max-h-[70vh] rounded-md bg-black"
          />
          <p
            v-else
            class="text-[11px] text-muted-foreground"
            data-testid="task-detail-expanded-fallback"
          >
            {{ t("taskDetail.noPreview") }}
          </p>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!presetPendingDelete" @update:open="presetPendingDelete = null">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-base">
            {{ t("app.actions.deletePresetConfirmTitle") }}
          </DialogTitle>
          <DialogDescription class="mt-1 text-xs text-muted-foreground">
            {{ t("app.actions.deletePresetConfirmMessage") }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            class="h-8 px-3 text-xs"
            @click="cancelDeletePreset"
          >
            {{ t("app.actions.cancel") }}
          </Button>
          <Button
            variant="destructive"
            class="h-8 px-3 text-xs"
            @click="confirmDeletePreset"
          >
            {{ t("app.actions.confirm") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
