<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openPathWithSystem } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  AutoCompressProgress,
  CompositeSmartScanTask,
  ExternalToolStatus,
  FFmpegPreset,
  QueueMode,
  QueueState,
  SmartScanConfig,
  TranscodeJob,
  QueueViewMode,
  TaskbarProgressMode,
} from "./types";
import { DEFAULT_SMART_SCAN_CONFIG, EXTENSIONS } from "./constants";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import { useQueuePreferences } from "@/lib/queuePreferences";
import {
  fetchExternalToolStatuses,
  buildPreviewUrl,
  hasTauri,
  loadAppSettings,
  loadPresets,
  loadQueueState,
  runAutoCompress,
  saveAppSettings,
  savePresetOnBackend,
  deletePresetOnBackend,
  enqueueTranscodeJob,
  cancelTranscodeJob,
  waitTranscodeJob,
  resumeTranscodeJob,
  restartTranscodeJob,
} from "@/lib/backend";

// Import composables
import {
  type QueueFilterStatus,
  type QueueFilterKind,
  type QueueSortField,
  type QueueSortDirection,
  type QueueListItem,
  useJobLog,
  useWindowControls,
  useDialogManager,
  useDragAndDrop,
  useMonitoring,
} from "@/composables";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";

// Import new components
import TitleBar from "@/components/TitleBar.vue";
import Sidebar from "@/components/Sidebar.vue";
import MonitorPanel from "@/components/panels/MonitorPanel.vue";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import QueuePanel from "@/components/panels/QueuePanel.vue";
import DeletePresetDialog from "@/components/dialogs/DeletePresetDialog.vue";
import JobDetailDialog from "@/components/dialogs/JobDetailDialog.vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import ExpandedPreviewDialog from "@/components/dialogs/ExpandedPreviewDialog.vue";

// Heavy UI subtrees are loaded lazily so the initial bundle stays smaller.
const ParameterWizard = defineAsyncComponent(() => import("./components/ParameterWizard.vue"));
const UltimateParameterPanel = defineAsyncComponent(() => import("./components/UltimateParameterPanel.vue"));
const SmartScanWizard = defineAsyncComponent(() => import("./components/SmartScanWizard.vue"));

const ICON_VIEW_MAX_VISIBLE_ITEMS = 200;

// Composables setup
const appWindow = ref<TauriWindow | null>(null);
const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWindowControls();
const dialogManager = useDialogManager();
const { cpuSnapshot, gpuSnapshot, startMonitoring, stopMonitoring } = useMonitoring({
  intervalMs: 2000,
  autoStart: false,
});

// Queue view preferences
const {
  queueViewMode,
  queueProgressStyle,
  queueMode,
  setQueueViewMode,
  setQueueMode,
} = useQueuePreferences();

const queueViewModeModel = computed<QueueViewMode>({
  get: () => queueViewMode.value,
  set: (value) => setQueueViewMode(value),
});

const queueModeModel = computed<QueueMode>({
  get: () => queueMode.value,
  set: (value) => setQueueMode(value),
});

const queueRowVariant = computed<"detail" | "compact">(() => {
  return queueViewMode.value === "compact" ? "compact" : "detail";
});

const isIconViewMode = computed(
  () =>
    queueViewMode.value === "icon-small" ||
    queueViewMode.value === "icon-medium" ||
    queueViewMode.value === "icon-large",
);

const iconViewSize = computed<"small" | "medium" | "large">(() => {
  if (queueViewMode.value === "icon-large") return "large";
  if (queueViewMode.value === "icon-medium") return "medium";
  return "small";
});

const iconGridClass = computed(() => {
  if (queueViewMode.value === "icon-large") {
    return "grid gap-3 grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
  }
  if (queueViewMode.value === "icon-medium") {
    return "grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4";
  }
  return "grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5";
});

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

// Core state
const activeTab = ref<"queue" | "presets" | "media" | "monitor" | "settings">("queue");
const presets = ref<FFmpegPreset[]>([...INITIAL_PRESETS]);
const presetsLoadedFromBackend = ref(false);
const jobs = ref<TranscodeJob[]>([]);
const manualJobPresetId = ref<string | null>(null);

const manualJobPreset = computed<FFmpegPreset | null>(() => {
  const list = presets.value;
  if (!list || list.length === 0) return null;
  const id = manualJobPresetId.value;
  if (!id) return list[0];
  return list.find((p) => p.id === id) ?? list[0];
});

// Smart scan batch metadata
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
    totalFilesScanned: Math.max(prev?.totalFilesScanned ?? 0, snapshot.totalFilesScanned),
    totalCandidates: Math.max(prev?.totalCandidates ?? 0, snapshot.totalCandidates),
    totalProcessed: Math.max(prev?.totalProcessed ?? 0, snapshot.totalProcessed),
    startedAtMs: prev?.startedAtMs ?? snapshot.startedAtMs,
    completedAtMs: snapshot.completedAtMs ?? prev?.completedAtMs,
  };
  smartScanBatchMeta.value = { ...smartScanBatchMeta.value, [snapshot.batchId]: next };
};

// UI state (using composables)
const smartConfig = ref<SmartScanConfig>({ ...DEFAULT_SMART_SCAN_CONFIG });
const smartScanRootPath = ref<string>("");
const fileInputRef = ref<HTMLInputElement | null>(null);
const folderInputRef = ref<HTMLInputElement | null>(null);
const presetPendingDelete = ref<FFmpegPreset | null>(null);
const appSettings = ref<AppSettings | null>(null);
const isSavingSettings = ref(false);
const settingsSaveError = ref<string | null>(null);
const toolStatuses = ref<ExternalToolStatus[]>([]);
let jobTimer: number | undefined;
let queueTimer: number | undefined;
let settingsSaveTimer: number | undefined;
let headerProgressFadeTimer: number | undefined;
let lastSavedSettingsSnapshot: string | null = null;
const queueError = ref<string | null>(null);
const lastQueueSnapshotAtMs = ref<number | null>(null);

// Job log composable
const { highlightedLogHtml } = useJobLog({ selectedJob: dialogManager.selectedJob });

// Queue filtering state
const selectedJobIds = ref<Set<string>>(new Set());
const hiddenJobIds = ref<Set<string>>(new Set());
const activeStatusFilters = ref<Set<QueueFilterStatus>>(new Set());
const activeTypeFilters = ref<Set<QueueFilterKind>>(new Set());
const filterText = ref("");
const filterUseRegex = ref(false);
const filterRegexError = ref<string | null>(null);
const filterRegex = ref<RegExp | null>(null);
let lastValidFilterRegex: RegExp | null = null;
const expandedBatchIds = ref<Set<string>>(new Set());

const sortPrimary = ref<QueueSortField>("addedTime");
const sortPrimaryDirection = ref<QueueSortDirection>("asc");
const sortSecondary = ref<QueueSortField>("filename");
const sortSecondaryDirection = ref<QueueSortDirection>("asc");

const hasActiveFilters = computed(() => {
  if (activeStatusFilters.value.size > 0) return true;
  if (activeTypeFilters.value.size > 0) return true;
  const text = filterText.value.trim();
  return !!text;
});

const hasSelection = computed(() => selectedJobIds.value.size > 0);

let queueUnlisten: UnlistenFn | null = null;
let smartScanProgressUnlisten: UnlistenFn | null = null;

const { t } = useI18n();

// Watch for regex filter changes
watch(
  [filterText, filterUseRegex],
  ([pattern, useRegex]) => {
    const text = (pattern ?? "").trim();
    if (!useRegex || !text) {
      filterRegex.value = null;
      filterRegexError.value = null;
      lastValidFilterRegex = null;
      return;
    }
    try {
      const rx = new RegExp(text, "i");
      filterRegex.value = rx;
      filterRegexError.value = null;
      lastValidFilterRegex = rx;
    } catch {
      filterRegexError.value = (t("queue.filters.invalidRegex") as string) || "无效的正则表达式";
      filterRegex.value = lastValidFilterRegex;
    }
  },
  { flush: "sync" },
);

// Progress interval
const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 250;
const progressUpdateIntervalMs = computed<number>(() => {
  const raw = appSettings.value?.progressUpdateIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.max(raw, 50), 2000);
  }
  return DEFAULT_PROGRESS_UPDATE_INTERVAL_MS;
});

// Progress helpers
const normalizedJobProgressForAggregate = (job: TranscodeJob): number => {
  if (["completed", "failed", "skipped", "cancelled"].includes(job.status)) return 1;
  if (job.status === "processing" || job.status === "paused") {
    const raw = typeof job.progress === "number" ? job.progress : 0;
    return Math.min(Math.max(raw, 0), 100) / 100;
  }
  return 0;
};

const taskbarJobWeightForAggregate = (job: TranscodeJob, mode: TaskbarProgressMode): number => {
  const media = job.mediaInfo;
  const sizeMb = Math.max(typeof media?.sizeMB === "number" ? media.sizeMB : job.originalSizeMB ?? 0, 0);
  const durationSeconds = Math.max(media?.durationSeconds ?? 0, 0);
  const estimatedSeconds = Math.max(job.estimatedSeconds ?? 0, 0);

  let weight: number;
  if (mode === "bySize") {
    weight = sizeMb > 0 ? sizeMb : 1;
  } else if (mode === "byDuration") {
    weight = durationSeconds > 0 ? durationSeconds : sizeMb > 0 ? sizeMb * 8 : 1;
  } else {
    weight = estimatedSeconds > 0 ? estimatedSeconds : durationSeconds > 0 ? durationSeconds : sizeMb > 0 ? sizeMb * 8 : 1;
  }
  return Math.max(weight, 1e-3);
};

const globalTaskbarProgressPercent = computed<number | null>(() => {
  const list = jobs.value;
  if (!list || list.length === 0) return null;
  const mode: TaskbarProgressMode = appSettings.value?.taskbarProgressMode ?? "byEstimatedTime";
  let totalWeight = 0;
  let weighted = 0;
  for (const job of list) {
    const w = taskbarJobWeightForAggregate(job, mode);
    const p = normalizedJobProgressForAggregate(job);
    totalWeight += w;
    weighted += w * p;
  }
  if (totalWeight <= 0) return null;
  return Math.max(0, Math.min(100, (weighted / totalWeight) * 100));
});

const hasActiveJobs = computed(() => {
  const list = jobs.value;
  if (!list || list.length === 0) return false;
  return list.some((job) => ["processing", "paused", "waiting", "queued"].includes(job.status));
});

// Header progress animation
const headerProgressPercent = ref(0);
const headerProgressVisible = ref(false);
const headerProgressFading = ref(false);

watch(
  [globalTaskbarProgressPercent, hasActiveJobs],
  ([percent, active]) => {
    if (percent != null && active) {
      headerProgressPercent.value = percent;
      headerProgressVisible.value = true;
      headerProgressFading.value = false;
      if (headerProgressFadeTimer !== undefined) {
        clearTimeout(headerProgressFadeTimer);
        headerProgressFadeTimer = undefined;
      }
    } else if (headerProgressVisible.value && !active) {
      headerProgressPercent.value = 100;
      headerProgressFading.value = true;
      if (headerProgressFadeTimer !== undefined) clearTimeout(headerProgressFadeTimer);
      headerProgressFadeTimer = window.setTimeout(() => {
        headerProgressVisible.value = false;
        headerProgressFading.value = false;
        headerProgressPercent.value = 0;
      }, 1200);
    }
  },
  { flush: "post" },
);

// Composite smart scan tasks
const compositeSmartScanTasks = computed<CompositeSmartScanTask[]>(() => {
  const byBatch = new Map<string, TranscodeJob[]>();
  for (const job of jobs.value) {
    if (job.source !== "smart_scan" || !job.batchId) continue;
    if (!byBatch.has(job.batchId)) byBatch.set(job.batchId, []);
    byBatch.get(job.batchId)!.push(job);
  }

  const tasks: CompositeSmartScanTask[] = [];
  for (const [batchId, batchJobs] of byBatch) {
    const meta = smartScanBatchMeta.value[batchId];
    let completedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let progressSum = 0;
    let currentJob: TranscodeJob | null = null;

    for (const job of batchJobs) {
      if (job.status === "completed") completedCount++;
      else if (job.status === "skipped") skippedCount++;
      else if (job.status === "failed") failedCount++;
      else if (job.status === "cancelled") cancelledCount++;
      const normalised = normalizedJobProgressForAggregate(job);
      progressSum += normalised * 100;
      if (job.status === "processing" && !currentJob) currentJob = job;
    }

    const overallProgress = batchJobs.length > 0 ? progressSum / batchJobs.length : 0;
    tasks.push({
      batchId,
      rootPath: meta?.rootPath ?? "",
      totalFilesScanned: meta?.totalFilesScanned ?? 0,
      totalCandidates: meta?.totalCandidates ?? batchJobs.length,
      totalProcessed: meta?.totalProcessed ?? 0,
      startedAtMs: meta?.startedAtMs,
      completedAtMs: meta?.completedAtMs,
      jobs: batchJobs,
      currentJob,
      overallProgress,
      completedCount,
      skippedCount,
      failedCount,
      cancelledCount,
      totalCount: batchJobs.length,
    });
  }
  return tasks;
});

const hasSmartScanBatches = computed(() => compositeSmartScanTasks.value.length > 0);

// Title and subtitle
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

// Filtering
const jobMatchesFilters = (job: TranscodeJob): boolean => {
  if (hiddenJobIds.value.has(job.id)) return false;
  if (activeStatusFilters.value.size > 0 && !activeStatusFilters.value.has(job.status as QueueFilterStatus)) return false;
  if (activeTypeFilters.value.size > 0) {
    const kind: QueueFilterKind = job.source === "smart_scan" ? "smartScan" : "manual";
    if (!activeTypeFilters.value.has(kind)) return false;
  }
  const text = filterText.value.trim();
  if (!text) return true;
  const haystack = (job.inputPath || job.filename || "").toLowerCase();
  if (!haystack) return false;
  if (filterUseRegex.value) {
    const rx = filterRegex.value;
    return rx ? rx.test(haystack) : true;
  }
  return haystack.includes(text.toLowerCase());
};

const batchMatchesFilters = (batch: CompositeSmartScanTask): boolean => {
  if (!hasActiveFilters.value) return true;
  if (batch.jobs.some((job) => jobMatchesFilters(job))) return true;
  const text = filterText.value.trim();
  if (!text) return false;
  const root = (batch.rootPath || "").toLowerCase();
  if (!root) return false;
  if (filterUseRegex.value) {
    const rx = filterRegex.value;
    return rx ? rx.test(root) : false;
  }
  return root.includes(text.toLowerCase());
};

const filteredJobs = computed<TranscodeJob[]>(() => jobs.value.filter((job) => jobMatchesFilters(job)));

// Sorting
const comparePrimitive = (a: string | number | null | undefined, b: string | number | null | undefined): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" && typeof b === "string") {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    return al < bl ? -1 : al > bl ? 1 : 0;
  }
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
};

const getJobSortValue = (job: TranscodeJob, field: QueueSortField) => {
  switch (field) {
    case "filename": {
      const raw = job.inputPath || job.filename || "";
      const lastSlash = raw.replace(/\\/g, "/").lastIndexOf("/");
      return lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw || null;
    }
    case "status": return job.status;
    case "addedTime": return job.startTime ?? null;
    case "finishedTime": return job.endTime ?? null;
    case "duration": return job.mediaInfo?.durationSeconds ?? null;
    case "elapsed": return job.startTime && job.endTime && job.endTime > job.startTime ? job.endTime - job.startTime : null;
    case "progress": return typeof job.progress === "number" ? job.progress : null;
    case "type": return job.type;
    case "path": return job.inputPath || job.filename || null;
    case "inputSize": return job.originalSizeMB ?? null;
    case "outputSize": return job.outputSizeMB ?? null;
    default: return null;
  }
};

const compareJobsByField = (a: TranscodeJob, b: TranscodeJob, field: QueueSortField, direction: QueueSortDirection): number => {
  const av = getJobSortValue(a, field);
  const bv = getJobSortValue(b, field);
  let result = comparePrimitive(av, bv);
  if (direction === "desc") result = -result;
  return result;
};

const compareJobsByConfiguredFields = (a: TranscodeJob, b: TranscodeJob): number => {
  let result = compareJobsByField(a, b, sortPrimary.value, sortPrimaryDirection.value);
  if (result !== 0) return result;
  return compareJobsByField(a, b, sortSecondary.value, sortSecondaryDirection.value);
};

const compareJobsForDisplay = (a: TranscodeJob, b: TranscodeJob): number => {
  let result = compareJobsByConfiguredFields(a, b);
  if (result !== 0) return result;
  const ao = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  const as = a.startTime ?? 0;
  const bs = b.startTime ?? 0;
  if (as !== bs) return as - bs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const displayModeSortedJobs = computed<TranscodeJob[]>(() => {
  const list = filteredJobs.value.slice();
  return list.length === 0 ? list : list.sort(compareJobsForDisplay);
});

const manualQueueJobs = computed<TranscodeJob[]>(() => filteredJobs.value.filter((job) => !job.batchId));

// Queue items for display
const visibleQueueItems = computed<QueueListItem[]>(() => {
  const items: QueueListItem[] = [];
  for (const batch of compositeSmartScanTasks.value) {
    if (batchMatchesFilters(batch)) items.push({ kind: "batch", batch });
  }
  for (const job of displayModeSortedJobs.value) {
    if (!job.batchId) items.push({ kind: "job", job });
  }
  return items;
});

const iconViewItems = computed<QueueListItem[]>(() => visibleQueueItems.value.slice(0, ICON_VIEW_MAX_VISIBLE_ITEMS));

const queueJobsForDisplay = computed(() => (queueMode.value === "queue" ? manualQueueJobs.value : displayModeSortedJobs.value));

// Queue mode specific job lists
const queueModeProcessingJobs = computed<TranscodeJob[]>(() => {
  return filteredJobs.value.filter((job) => !job.batchId && job.status === "processing");
});

const queueModeWaitingJobs = computed<TranscodeJob[]>(() => {
  return filteredJobs.value.filter((job) => !job.batchId && ["waiting", "queued", "paused"].includes(job.status));
});

// Settings management
const ensureAppSettingsLoaded = async () => {
  if (!hasTauri()) return;
  if (appSettings.value) return;
  try {
    const loaded = await loadAppSettings();
    if (loaded) {
      appSettings.value = loaded;
      lastSavedSettingsSnapshot = JSON.stringify(loaded);
    }
  } catch (e) {
    console.error("Failed to load app settings:", e);
  }
};

const scheduleSaveSettings = () => {
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = window.setTimeout(async () => {
    if (!appSettings.value || !hasTauri()) return;
    const currentSnapshot = JSON.stringify(appSettings.value);
    if (currentSnapshot === lastSavedSettingsSnapshot) return;
    isSavingSettings.value = true;
    settingsSaveError.value = null;
    try {
      await saveAppSettings(appSettings.value);
      lastSavedSettingsSnapshot = currentSnapshot;
    } catch (e) {
      settingsSaveError.value = String(e);
    } finally {
      isSavingSettings.value = false;
    }
  }, 800);
};

watch(appSettings, scheduleSaveSettings, { deep: true });

// Tool status
const refreshToolStatuses = async () => {
  if (!hasTauri()) return;
  try {
    const statuses = await fetchExternalToolStatuses();
    if (statuses) toolStatuses.value = statuses;
  } catch (e) {
    console.error("Failed to fetch tool statuses:", e);
  }
};

// Preset management
const handleSavePreset = async (preset: FFmpegPreset) => {
  const idx = presets.value.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    presets.value.splice(idx, 1, preset);
  } else {
    presets.value.push(preset);
  }
  dialogManager.closeWizard();
  dialogManager.closeParameterPanel();
  if (hasTauri()) {
    try {
      await savePresetOnBackend(preset);
    } catch (e) {
      console.error("Failed to save preset to backend:", e);
    }
  }
};

const requestDeletePreset = (preset: FFmpegPreset) => {
  presetPendingDelete.value = preset;
};

const confirmDeletePreset = async () => {
  const preset = presetPendingDelete.value;
  if (!preset) return;
  const idx = presets.value.findIndex((p) => p.id === preset.id);
  if (idx >= 0) presets.value.splice(idx, 1);
  presetPendingDelete.value = null;
  if (hasTauri()) {
    try {
      await deletePresetOnBackend(preset.id);
    } catch (e) {
      console.error("Failed to delete preset from backend:", e);
    }
  }
};

const cancelDeletePreset = () => {
  presetPendingDelete.value = null;
};

const openPresetEditor = (preset: FFmpegPreset) => {
  dialogManager.openParameterPanel(preset);
};

// Job operations
const handleCancelJob = async (jobId: string) => {
  if (!hasTauri()) return;
  try {
    await cancelTranscodeJob(jobId);
  } catch (e) {
    console.error("Failed to cancel job:", e);
  }
};

const handleWaitJob = async (jobId: string) => {
  if (!hasTauri()) return;
  try {
    await waitTranscodeJob(jobId);
  } catch (e) {
    console.error("Failed to wait job:", e);
  }
};

const handleResumeJob = async (jobId: string) => {
  if (!hasTauri()) return;
  try {
    await resumeTranscodeJob(jobId);
  } catch (e) {
    console.error("Failed to resume job:", e);
  }
};

const handleRestartJob = async (jobId: string) => {
  if (!hasTauri()) return;
  try {
    await restartTranscodeJob(jobId);
  } catch (e) {
    console.error("Failed to restart job:", e);
  }
};

const openJobDetail = (job: TranscodeJob) => {
  dialogManager.openJobDetail(job);
};

// Preview state and handlers
const previewUrl = ref<string | null>(null);
const previewIsImage = ref(false);
const previewError = ref<string | null>(null);

const openJobPreviewFromQueue = async (job: TranscodeJob) => {
  previewUrl.value = null;
  previewIsImage.value = job.type === "image";
  previewError.value = null;
  dialogManager.openPreview(job);

  if (hasTauri()) {
    try {
      const path = job.outputPath || job.inputPath;
      if (path) {
        const url = await buildPreviewUrl(path);
        previewUrl.value = url;
      }
    } catch (e) {
      previewError.value = String(e);
    }
  }
};

const closeExpandedPreview = () => {
  dialogManager.closePreview();
  previewUrl.value = null;
  previewError.value = null;
};

const handleExpandedPreviewError = () => {
  previewError.value = "无法加载预览，视频文件可能正在被占用或已损坏。";
};

const handleExpandedImagePreviewError = () => {
  previewError.value = "无法加载图片预览，文件可能正在被占用或已损坏。";
};

const openPreviewInSystemPlayer = async () => {
  const job = dialogManager.selectedJob.value;
  if (!job) return;
  const path = job.outputPath || job.inputPath;
  if (!path || !hasTauri()) return;
  try {
    await openPathWithSystem(path);
  } catch (e) {
    console.error("Failed to open in system player:", e);
  }
};

const openBatchDetail = (batch: CompositeSmartScanTask) => {
  dialogManager.openBatchDetail(batch);
};

// Handle JobDetailDialog expand preview
const handleJobDetailExpandPreview = () => {
  const job = dialogManager.selectedJob.value;
  if (job) {
    openJobPreviewFromQueue(job);
  }
};

// Get preset for current job
const selectedJobPreset = computed<FFmpegPreset | null>(() => {
  const job = dialogManager.selectedJob.value;
  if (!job) return null;
  return presets.value.find((p) => p.id === job.presetId) ?? presets.value[0] ?? null;
});

// File input handlers
const handleFileInputChange = async () => {
  // Implementation for file input
};

const handleFolderInputChange = async () => {
  // Implementation for folder input
};

// Add manual job
const addManualJob = async () => {
  if (!hasTauri()) return;
  try {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"] }],
    });
    if (!selected || selected.length === 0) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const path of paths) {
      await enqueueManualJobFromPath(path);
    }
  } catch (e) {
    console.error("Failed to add manual job:", e);
  }
};

const enqueueManualJobFromPath = async (inputPath: string) => {
  if (!hasTauri()) return;
  const preset = manualJobPreset.value ?? presets.value[0];
  if (!preset) return;
  try {
    // Extract filename from path
    const filename = inputPath.replace(/\\/g, "/").split("/").pop() || inputPath;
    await enqueueTranscodeJob({
      filename,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0, // Will be filled by backend
      presetId: preset.id,
    });
  } catch (e) {
    console.error("Failed to enqueue job:", e);
  }
};

// Smart scan
const startSmartScan = async () => {
  if (!hasTauri()) return;
  try {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;
    const root = Array.isArray(selected) ? selected[0] : selected;
    smartScanRootPath.value = root;
    smartConfig.value = { ...DEFAULT_SMART_SCAN_CONFIG };
    dialogManager.openSmartScan();
  } catch (e) {
    console.error("Failed to start smart scan:", e);
  }
};

const runSmartScan = async (config: SmartScanConfig) => {
  if (!hasTauri()) return;
  dialogManager.closeSmartScan();
  try {
    const rootPath = smartScanRootPath.value;
    if (!rootPath) {
      console.error("No root path for smart scan");
      return;
    }
    await runAutoCompress(rootPath, config);
  } catch (e) {
    console.error("Failed to run smart scan:", e);
    queueError.value = String(e);
  }
};

// Selection helpers
const toggleJobSelected = (jobId: string) => {
  const next = new Set(selectedJobIds.value);
  if (next.has(jobId)) next.delete(jobId);
  else next.add(jobId);
  selectedJobIds.value = next;
};

// Filter toggle handlers
const toggleStatusFilter = (status: QueueFilterStatus) => {
  const next = new Set(activeStatusFilters.value);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  activeStatusFilters.value = next;
};

const toggleTypeFilter = (kind: QueueFilterKind) => {
  const next = new Set(activeTypeFilters.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  activeTypeFilters.value = next;
};

const toggleFilterRegexMode = () => {
  filterUseRegex.value = !filterUseRegex.value;
};

const resetQueueFilters = () => {
  activeStatusFilters.value = new Set();
  activeTypeFilters.value = new Set();
  filterText.value = "";
  filterUseRegex.value = false;
  filterRegexError.value = null;
};

// Batch expansion
const toggleBatchExpanded = (batchId: string) => {
  const next = new Set(expandedBatchIds.value);
  if (next.has(batchId)) next.delete(batchId);
  else next.add(batchId);
  expandedBatchIds.value = next;
};

// Bulk selection helpers
const selectAllVisibleJobs = () => {
  const next = new Set(selectedJobIds.value);
  for (const item of visibleQueueItems.value) {
    if (item.kind === "job") next.add(item.job.id);
  }
  selectedJobIds.value = next;
};

const invertSelection = () => {
  const next = new Set<string>();
  for (const item of visibleQueueItems.value) {
    if (item.kind === "job" && !selectedJobIds.value.has(item.job.id)) {
      next.add(item.job.id);
    }
  }
  selectedJobIds.value = next;
};

const clearSelection = () => {
  selectedJobIds.value = new Set();
};

// Bulk operations
const bulkCancel = async () => {
  if (!hasTauri()) return;
  for (const jobId of selectedJobIds.value) {
    try {
      await cancelTranscodeJob(jobId);
    } catch (e) {
      console.error("Failed to cancel job:", e);
    }
  }
};

const bulkWait = async () => {
  if (!hasTauri()) return;
  for (const jobId of selectedJobIds.value) {
    try {
      await waitTranscodeJob(jobId);
    } catch (e) {
      console.error("Failed to wait job:", e);
    }
  }
};

const bulkResume = async () => {
  if (!hasTauri()) return;
  for (const jobId of selectedJobIds.value) {
    try {
      await resumeTranscodeJob(jobId);
    } catch (e) {
      console.error("Failed to resume job:", e);
    }
  }
};

const bulkRestart = async () => {
  if (!hasTauri()) return;
  for (const jobId of selectedJobIds.value) {
    try {
      await restartTranscodeJob(jobId);
    } catch (e) {
      console.error("Failed to restart job:", e);
    }
  }
};

const bulkMoveToTop = () => {
  // TODO: Implement when backend supports queue reordering
  console.log("bulkMoveToTop not yet implemented");
};

const bulkMoveToBottom = () => {
  // TODO: Implement when backend supports queue reordering
  console.log("bulkMoveToBottom not yet implemented");
};

const bulkDelete = () => {
  // Hide selected jobs from view
  const next = new Set(hiddenJobIds.value);
  for (const jobId of selectedJobIds.value) {
    next.add(jobId);
  }
  hiddenJobIds.value = next;
  selectedJobIds.value = new Set();
};

// Drag and drop handler (called by useDragAndDrop composable)
const handleTauriFileDrop = async (paths: string[]) => {
  for (const path of paths) {
    await enqueueManualJobFromPath(path);
  }
};

// Setup drag and drop composable
const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragAndDrop({
  onFilesDropped: handleTauriFileDrop,
});

// Settings update handler
const handleUpdateAppSettings = (settings: AppSettings) => {
  appSettings.value = settings;
};

// Copy to clipboard helper
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

// Watch activeTab to control monitoring
watch(activeTab, (newTab, oldTab) => {
  if (newTab === "monitor" && oldTab !== "monitor") {
    startMonitoring();
  } else if (newTab !== "monitor" && oldTab === "monitor") {
    stopMonitoring();
  }
});

// Lifecycle
onMounted(async () => {
  if (hasTauri()) {
    try {
      appWindow.value = await getCurrentWindow();
    } catch (e) {
      console.error("Failed to get current window:", e);
    }

    // Load initial data
    await ensureAppSettingsLoaded();
    await refreshToolStatuses();

    // Load presets
    try {
      const loaded = await loadPresets();
      if (loaded && loaded.length > 0) {
        presets.value = loaded;
        presetsLoadedFromBackend.value = true;
      }
    } catch (e) {
      console.error("Failed to load presets:", e);
    }

    // Load queue state
    try {
      const state = await loadQueueState();
      if (state) {
        jobs.value = state.jobs;
        lastQueueSnapshotAtMs.value = Date.now();
      }
    } catch (e) {
      console.error("Failed to load queue state:", e);
    }

    // Listen for queue updates
    queueUnlisten = await listen<QueueState>("queue_state", (event) => {
      jobs.value = event.payload.jobs;
      lastQueueSnapshotAtMs.value = Date.now();
    });

    // Listen for smart scan progress
    smartScanProgressUnlisten = await listen<AutoCompressProgress>("auto_compress_progress", (event) => {
      const { batchId, totalFilesScanned, totalCandidates, totalProcessed, rootPath } = event.payload;
      if (batchId) {
        applySmartScanBatchMetaSnapshot({
          batchId,
          rootPath: rootPath ?? "",
          totalFilesScanned: totalFilesScanned ?? 0,
          totalCandidates: totalCandidates ?? 0,
          totalProcessed: totalProcessed ?? 0,
        });
      }
    });

    // Start monitoring if already on monitor tab
    if (activeTab.value === "monitor") {
      startMonitoring();
    }
  }
});

onUnmounted(() => {
  if (queueUnlisten) queueUnlisten();
  if (smartScanProgressUnlisten) smartScanProgressUnlisten();
  if (jobTimer !== undefined) clearTimeout(jobTimer);
  if (queueTimer !== undefined) clearTimeout(queueTimer);
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  if (headerProgressFadeTimer !== undefined) clearTimeout(headerProgressFadeTimer);
});
</script>

<template>
  <div
    class="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground m-0 p-0"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Drag overlay -->
    <div
      v-if="isDragging"
      class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-blue-900/80 backdrop-blur-md pointer-events-none"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-blue-400/70 bg-blue-600/60 shadow-lg mb-4">
        <span class="text-[10px] font-semibold tracking-[0.2em] uppercase text-blue-200">Drop</span>
      </div>
      <h2 class="text-2xl font-semibold text-white">Drop files to enqueue</h2>
      <p class="mt-1 text-sm text-blue-200">Release to create manual jobs in the queue</p>
    </div>

    <!-- Hidden file inputs -->
    <input
      ref="fileInputRef"
      type="file"
      class="hidden"
      :accept="EXTENSIONS.videos.join(',')"
      @change="handleFileInputChange"
    />
    <input
      ref="folderInputRef"
      type="file"
      webkitdirectory
      class="hidden"
      @change="handleFolderInputChange"
    />

    <!-- Title bar -->
    <TitleBar
      :progress-percent="headerProgressPercent"
      :progress-visible="headerProgressVisible"
      :progress-fading="headerProgressFading"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximizeWindow"
      @close="closeWindow"
    />

    <div class="flex flex-1 min-h-0 flex-row overflow-hidden">
      <!-- Sidebar -->
      <Sidebar
        :active-tab="activeTab"
        :jobs="jobs"
        @update:active-tab="activeTab = $event"
        @add-job="addManualJob"
        @smart-scan="startSmartScan"
      />

      <!-- Main content -->
      <main class="flex-1 flex min-h-0 flex-col bg-background">
        <!-- Content header -->
        <header class="shrink-0 px-4 py-2 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between gap-2">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-3 min-h-8">
              <h2 class="text-xl font-semibold tracking-tight text-foreground">{{ currentTitle }}</h2>
              <span v-if="activeTab === 'queue' && jobs.length > 0" class="bg-muted text-xs text-muted-foreground px-2 py-1 rounded-full">
                {{ jobs.filter((j) => j.status === "completed").length }} / {{ jobs.length }}
              </span>
            </div>
            <p class="text-xs text-muted-foreground min-h-[1.25rem]">{{ currentSubtitle }}</p>
          </div>

          <!-- Queue controls -->
          <div v-if="activeTab === 'queue'" class="flex items-center gap-3">
            <div v-if="presets.length > 0" class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground whitespace-nowrap">{{ t("app.queueDefaultPresetLabel") }}</span>
              <Select v-model="manualJobPresetId">
                <SelectTrigger class="h-7 px-3 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[160px]">
                  <SelectValue :placeholder="t('app.queueDefaultPresetPlaceholder')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">
                    {{ preset.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Select v-model="queueModeModel">
              <SelectTrigger class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="display">{{ t("queue.modes.display") }}</SelectItem>
                <SelectItem value="queue">{{ t("queue.modes.queue") }}</SelectItem>
              </SelectContent>
            </Select>

            <Select v-model="queueViewModeModel">
              <SelectTrigger class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[104px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="detail">{{ t("queue.viewModes.detail") }}</SelectItem>
                <SelectItem value="compact">{{ t("queue.viewModes.compact") }}</SelectItem>
                <SelectItem value="icon-small">{{ t("queue.viewModes.iconSmall") }}</SelectItem>
                <SelectItem value="icon-medium">{{ t("queue.viewModes.iconMedium") }}</SelectItem>
                <SelectItem value="icon-large">{{ t("queue.viewModes.iconLarge") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </header>

        <!-- Content area -->
        <ScrollArea class="flex-1">
          <div class="p-4">
            <!-- Queue Tab -->
            <QueuePanel
              v-if="activeTab === 'queue'"
              :queue-jobs-for-display="queueJobsForDisplay"
              :visible-queue-items="visibleQueueItems"
              :icon-view-items="iconViewItems"
              :queue-mode-processing-jobs="queueModeProcessingJobs"
              :queue-mode-waiting-jobs="queueModeWaitingJobs"
              :presets="presets"
              :queue-view-mode="queueViewMode"
              :queue-progress-style="queueProgressStyle"
              :queue-mode="queueMode"
              :is-icon-view-mode="isIconViewMode"
              :icon-view-size="iconViewSize"
              :icon-grid-class="iconGridClass"
              :queue-row-variant="queueRowVariant"
              :progress-update-interval-ms="progressUpdateIntervalMs"
              :has-smart-scan-batches="hasSmartScanBatches"
              :active-status-filters="activeStatusFilters"
              :active-type-filters="activeTypeFilters"
              :filter-text="filterText"
              :filter-use-regex="filterUseRegex"
              :filter-regex-error="filterRegexError"
              :sort-primary="sortPrimary"
              :sort-primary-direction="sortPrimaryDirection"
              :has-selection="hasSelection"
              :has-active-filters="hasActiveFilters"
              :expanded-batch-ids="expandedBatchIds"
              :queue-error="queueError"
              @update:queue-view-mode="setQueueViewMode"
              @update:queue-mode="setQueueMode"
              @update:filter-text="(v) => filterText = v"
              @update:sort-primary="(v) => sortPrimary = v"
              @update:sort-primary-direction="(v) => sortPrimaryDirection = v"
              @add-job="addManualJob"
              @toggle-status-filter="toggleStatusFilter"
              @toggle-type-filter="toggleTypeFilter"
              @toggle-filter-regex-mode="toggleFilterRegexMode"
              @reset-queue-filters="resetQueueFilters"
              @select-all-visible-jobs="selectAllVisibleJobs"
              @invert-selection="invertSelection"
              @clear-selection="clearSelection"
              @bulk-cancel="bulkCancel"
              @bulk-wait="bulkWait"
              @bulk-resume="bulkResume"
              @bulk-restart="bulkRestart"
              @bulk-move-to-top="bulkMoveToTop"
              @bulk-move-to-bottom="bulkMoveToBottom"
              @bulk-delete="bulkDelete"
              @cancel-job="handleCancelJob"
              @wait-job="handleWaitJob"
              @resume-job="handleResumeJob"
              @restart-job="handleRestartJob"
              @toggle-job-selected="toggleJobSelected"
              @inspect-job="openJobDetail"
              @preview-job="openJobPreviewFromQueue"
              @toggle-batch-expanded="toggleBatchExpanded"
              @open-batch-detail="openBatchDetail"
            />

            <!-- Presets Tab -->
            <PresetPanel
              v-else-if="activeTab === 'presets'"
              :presets="presets"
              @edit="openPresetEditor"
              @delete="requestDeletePreset"
            />

            <!-- Monitor Tab -->
            <MonitorPanel
              v-else-if="activeTab === 'monitor'"
              :cpu-snapshot="cpuSnapshot ?? null"
              :gpu-snapshot="gpuSnapshot ?? null"
            />

            <!-- Settings Tab -->
            <SettingsPanel
              v-else-if="activeTab === 'settings'"
              :app-settings="appSettings"
              :tool-statuses="toolStatuses"
              :is-saving-settings="isSavingSettings"
              :settings-save-error="settingsSaveError"
              @refresh-tool-statuses="refreshToolStatuses"
              @update:app-settings="handleUpdateAppSettings"
            />

            <!-- Media Tab placeholder -->
            <div v-else-if="activeTab === 'media'" class="text-center py-16 text-muted-foreground">
              <p class="text-lg font-medium">{{ t("app.tabs.media") }}</p>
              <p class="text-sm">Coming soon...</p>
            </div>
          </div>
        </ScrollArea>
      </main>
    </div>

    <!-- Dialogs -->
    <ParameterWizard
      v-if="dialogManager.wizardOpen.value"
      :initial-preset="dialogManager.editingPreset.value"
      @save="handleSavePreset"
      @cancel="dialogManager.closeWizard()"
    />

    <UltimateParameterPanel
      v-if="dialogManager.parameterPanelOpen.value && dialogManager.editingPreset.value"
      :initial-preset="dialogManager.editingPreset.value"
      @save="handleSavePreset"
      @cancel="dialogManager.closeParameterPanel()"
    />

    <SmartScanWizard
      v-if="dialogManager.smartScanOpen.value"
      :initial-config="smartConfig"
      :presets="presets"
      @run="runSmartScan"
      @cancel="dialogManager.closeSmartScan()"
    />

    <DeletePresetDialog
      :open="!!presetPendingDelete"
      :preset="presetPendingDelete"
      @update:open="presetPendingDelete = null"
      @confirm="confirmDeletePreset"
      @cancel="cancelDeletePreset"
    />

    <!-- Job Detail Dialog -->
    <JobDetailDialog
      :open="dialogManager.jobDetailOpen.value"
      :job="dialogManager.selectedJob.value"
      :preset="selectedJobPreset"
      :highlighted-log-html="highlightedLogHtml"
      @update:open="(val) => { if (!val) dialogManager.closeJobDetail(); }"
      @expand-preview="handleJobDetailExpandPreview"
      @copy-command="copyToClipboard"
    />

    <!-- Batch Detail Dialog -->
    <BatchDetailDialog
      :open="dialogManager.batchDetailOpen.value"
      :batch="dialogManager.selectedBatch.value"
      :presets="presets"
      :progress-style="queueProgressStyle"
      :progress-update-interval-ms="progressUpdateIntervalMs"
      @update:open="(val) => { if (!val) dialogManager.closeBatchDetail(); }"
      @inspect-job="openJobDetail"
      @preview-job="openJobPreviewFromQueue"
      @cancel-job="handleCancelJob"
    />

    <!-- Expanded Preview Dialog -->
    <ExpandedPreviewDialog
      :open="dialogManager.previewOpen.value"
      :job="dialogManager.selectedJob.value"
      :preview-url="previewUrl"
      :is-image="previewIsImage"
      :error="previewError"
      @update:open="(open) => { if (!open) closeExpandedPreview(); }"
      @video-error="handleExpandedPreviewError"
      @image-error="handleExpandedImagePreviewError"
      @open-in-system-player="openPreviewInSystemPlayer"
      @copy-path="copyToClipboard(dialogManager.selectedJob.value?.inputPath || dialogManager.selectedJob.value?.outputPath)"
    />
  </div>
</template>
