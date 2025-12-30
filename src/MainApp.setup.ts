import { computed, inject, provide, ref, watch, type ComputedRef, type InjectionKey } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, FFmpegPreset, PresetSortMode, PresetViewMode, TranscodeJob } from "@/types";
import { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { useMainAppQueue, type UseMainAppQueueReturn } from "@/composables/main-app/useMainAppQueue";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import { useMainAppUpdater } from "@/composables/main-app/useMainAppUpdater";
import { useQueueOutputPolicy } from "@/composables/main-app/useQueueOutputPolicy";
import { useJobLog } from "@/composables";
import { useMainAppExitConfirm } from "@/composables/main-app/useMainAppExitConfirm";
import { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { hasTauri } from "@/lib/backend";
import { scheduleStartupIdle } from "@/composables/main-app/startupIdle";
import { useUiAppearanceSync } from "@/composables/main-app/useUiAppearanceSync";
import { useBatchCompressQueueRefresh } from "@/composables/main-app/useBatchCompressQueueRefresh";
import { useQueueStartupToast } from "@/composables/main-app/useQueueStartupToast";
import { useBodyPointerEventsFailsafe } from "@/composables/main-app/useBodyPointerEventsFailsafe";
import { usePresetPanelModePersistence } from "@/composables/main-app/usePresetPanelModePersistence";

type MainAppQueueTabModule = UseMainAppQueueReturn & {
  selectionBarPinned: ComputedRef<boolean>;
  setSelectionBarPinned: (pinned: boolean) => void;
  queueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["queueOutputPolicy"];
  setQueueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["setQueueOutputPolicy"];
  queuePanelProps: ReturnType<typeof createQueuePanelProps>;
  queueTotalCount: ComputedRef<number>;
};
export function createMainAppContext() {
  const { t, locale } = useI18n();
  const jobs = ref<TranscodeJob[]>([]);
  const queueError = ref<string | null>(null);
  const lastQueueSnapshotAtMs = ref<number | null>(null);
  const lastQueueSnapshotRevision = ref<number | null>(null);
  const lastDroppedRoot = ref<string | null>(null);
  const presets = ref<FFmpegPreset[]>([]);
  const presetsLoadedFromBackend = ref(false);
  const manualJobPresetId = ref<string | null>(null);
  const presetSortMode = ref<PresetSortMode>("manual");
  const presetViewMode = ref<PresetViewMode>("grid");
  const completedCount = computed(() => jobs.value.filter((job) => job.status === "completed").length);
  // Startup idle gate: defer non-critical startup calls until after first paint.
  // In tests, the gate starts open for deterministic behaviour.
  const startupIdleReady = ref(false);
  const isTestEnv =
    typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

  if (isTestEnv || typeof window === "undefined") {
    startupIdleReady.value = true;
  } else {
    const rawTimeoutMs =
      typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
        ? Number(import.meta.env.VITE_STARTUP_IDLE_TIMEOUT_MS)
        : NaN;
    const idleTimeoutMs = Number.isFinite(rawTimeoutMs) ? rawTimeoutMs : 1200;

    scheduleStartupIdle(
      () => {
        if (typeof performance !== "undefined" && "mark" in performance) {
          performance.mark("startup_idle_ready");
        }
        startupIdleReady.value = true;
      },
      { timeoutMs: idleTimeoutMs },
    );
  }

  const shell = useMainAppShell();
  const dialogs = useMainAppDialogs();
  useMainAppExitConfirm(dialogs.dialogManager);

  const batchCompress = useMainAppBatchCompress({
    t,
    activeTab: shell.activeTab,
    jobs,
    presets,
    queueError,
    lastDroppedRoot,
    dialogManager: dialogs.dialogManager,
  });

  const presetsModule = useMainAppPresets({
    t,
    locale,
    presets,
    presetsLoadedFromBackend,
    manualJobPresetId,
    dialogManager: dialogs.dialogManager,
    shell,
  });

  const queue = useMainAppQueue({
    t,
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
    presets,
    manualJobPresetId,
    compositeBatchCompressTasks: batchCompress.compositeBatchCompressTasks,
    compositeTasksById: batchCompress.compositeTasksById,
    onJobCompleted: presetsModule.handleCompletedJobFromBackend,
    startupIdleReady,
  }) as MainAppQueueTabModule;

  useQueueStartupToast({
    enabled: !isTestEnv,
    t,
    jobs,
    lastQueueSnapshotRevision,
    refreshQueueFromBackend: queue.refreshQueueFromBackend,
  });

  useBatchCompressQueueRefresh({
    batchCompressBatchMeta: batchCompress.batchCompressBatchMeta,
    jobs,
    refreshQueueFromBackend: queue.refreshQueueFromBackend,
  });

  const settings = useMainAppSettings({
    jobs,
    queueStructureRevision: lastQueueSnapshotRevision,
    manualJobPresetId,
    smartConfig: batchCompress.smartConfig,
    startupIdleReady,
  });
  useUiAppearanceSync(settings.appSettings);
  usePresetPanelModePersistence({
    presetSortMode,
    presetViewMode,
    appSettings: settings.appSettings,
    ensureAppSettingsLoaded: settings.ensureAppSettingsLoaded,
    persistNow: settings.persistNow,
  });

  // Restore preferred UI locale after AppSettings load. Keep the assignment
  // scoped to supported locales so future/unknown values do not break i18n.
  watch(
    () => settings.appSettings.value?.locale,
    (nextLocale) => {
      if (typeof nextLocale !== "string") return;
      const normalized = nextLocale.trim();
      if (normalized !== "en" && normalized !== "zh-CN") return;
      if (locale.value === normalized) return;
      locale.value = normalized;
    },
    { flush: "post", immediate: true },
  );

  const updater = useMainAppUpdater({
    appSettings: settings.appSettings,
    scheduleSaveSettings: settings.scheduleSaveSettings,
    persistNow: settings.persistNow,
    startupIdleReady,
  });

  const media = useMainAppMedia({
    t,
    activeTab: shell.activeTab,
  });

  const preview = useMainAppPreview({
    presets,
    dialogManager: dialogs.dialogManager,
    t,
  });

  const dnd = useMainAppDnDAndContextMenu({
    activeTab: shell.activeTab,
    inspectMediaForPath: media.inspectMediaForPath,
    enqueueManualJobsFromPaths: queue.enqueueManualJobsFromPaths,
    selectedJobIds: queue.selectedJobIds,
    bulkMoveSelectedJobsToTopInner: queue.bulkMoveSelectedJobsToTopInner,
  });

  const titleForTab = {
    queue: () => t("app.tabs.queue"),
    presets: () => t("app.tabs.presets"),
    media: () => t("app.tabs.media"),
    monitor: () => t("app.tabs.monitor"),
    settings: () => t("app.tabs.settings"),
  } as const;
  const subtitleForTab = {
    queue: () => t("app.queueHint"),
    presets: () => t("app.presetsHint"),
    media: () => t("app.mediaHint"),
    monitor: () => t("app.monitorHint"),
    settings: () => t("app.settingsHint"),
  } as const;
  const currentTitle = computed(() => titleForTab[shell.activeTab.value]?.() ?? titleForTab.queue());
  const currentSubtitle = computed(() => subtitleForTab[shell.activeTab.value]?.() ?? "");

  // One-time smart preset onboarding: when AppSettings are loaded in a Tauri
  // environment and onboardingCompleted is false/undefined, automatically
  // open the smart preset import dialog once.
  const autoOnboardingTriggered = ref(false);

  const markOnboardingCompleted = async () => {
    if (!hasTauri()) return;
    const current = settings.appSettings.value;
    if (!current || current.onboardingCompleted) return;

    const next: AppSettings = { ...current, onboardingCompleted: true };
    settings.appSettings.value = next;
    // Persist immediately and sync the internal saved snapshot to avoid
    // duplicate debounced writes.
    await settings.persistNow(next);
  };

  const handleImportSmartPackConfirmed = async (presetsToImport: FFmpegPreset[]) => {
    const shouldReplaceExisting = !settings.appSettings.value?.onboardingCompleted;
    await presetsModule.handleImportSmartPackConfirmed(presetsToImport, {
      replaceExisting: shouldReplaceExisting,
    });
    await markOnboardingCompleted();
  };

  watch(
    () => settings.appSettings.value,
    (value) => {
      if (!hasTauri()) return;
      if (!value) return;

      if (!value.onboardingCompleted && !autoOnboardingTriggered.value) {
        autoOnboardingTriggered.value = true;
        dialogs.dialogManager.openSmartPresetImport();
      }
    },
    { flush: "post" },
  );
  // 选择操作栏固定状态（从 AppSettings 读取）
  const selectionBarPinned = computed(() => settings.appSettings.value?.selectionBarPinned ?? false);
  // 更新选择操作栏固定状态
  const setSelectionBarPinned = (pinned: boolean) => {
    // 即使 appSettings 尚未加载，也允许更新（会在内存中创建临时设置）
    const current = settings.appSettings.value;
    if (current?.selectionBarPinned === pinned) return;

    const nextSettings: AppSettings = {
      ...(current ?? ({ tools: {}, batchCompressDefaults: {}, previewCapturePercent: 50 } as AppSettings)),
      selectionBarPinned: pinned,
    };
    // 直接更新 appSettings，useAppSettings 的 watch 会自动触发持久化
    settings.appSettings.value = nextSettings;
  };

  // 预设选择操作栏固定状态（从 AppSettings 读取）
  const presetSelectionBarPinned = computed(() => settings.appSettings.value?.presetSelectionBarPinned ?? false);
  // 更新预设选择操作栏固定状态
  const setPresetSelectionBarPinned = (pinned: boolean) => {
    // 即使 appSettings 尚未加载，也允许更新（会在内存中创建临时设置）
    const current = settings.appSettings.value;
    if (current?.presetSelectionBarPinned === pinned) return;

    const nextSettings: AppSettings = {
      ...(current ?? ({ tools: {}, batchCompressDefaults: {}, previewCapturePercent: 50 } as AppSettings)),
      presetSelectionBarPinned: pinned,
    };
    // 直接更新 appSettings，useAppSettings 的 watch 会自动触发持久化
    settings.appSettings.value = nextSettings;
  };

  const { queueOutputPolicy, setQueueOutputPolicy } = useQueueOutputPolicy(settings.appSettings);
  const queueTotalCount = computed(() => jobs.value.length);
  const { dialogManager, selectedJobForDetail } = dialogs;
  // Best-effort resolution of concrete ffmpeg/ffprobe paths for UI display.
  // Prefer the backend-probed resolvedPath (which already accounts for
  // auto-download and PATH lookup) and fall back to the custom path stored in
  // AppSettings when status snapshots are not yet available.
  const ffmpegResolvedPath = computed(() => {
    const status = settings.toolStatuses.value.find((s) => s.kind === "ffmpeg");
    if (status?.resolvedPath) return status.resolvedPath;
    return settings.appSettings.value?.tools?.ffmpegPath ?? null;
  });
  const queuePanelProps = createQueuePanelProps({
    queueJobsForDisplay: queue.queueJobsForDisplay,
    visibleQueueItems: queue.visibleQueueItems,
    iconViewItems: queue.iconViewItems,
    queueModeProcessingJobs: queue.queueModeProcessingJobs,
    queueModeWaitingItems: queue.queueModeWaitingItems,
    queueModeWaitingBatchIds: queue.queueModeWaitingBatchIds,
    presets,
    queueViewMode: queue.queueViewMode,
    // Expand bare `ffmpeg` tokens in the "full command" view using the
    // backend-resolved executable path so users can copy the actual command.
    ffmpegResolvedPath,
    queueProgressStyleModel: queue.queueProgressStyleModel,
    queueMode: queue.queueMode,
    isIconViewMode: queue.isIconViewMode,
    isCarousel3dViewMode: queue.isCarousel3dViewMode,
    carouselAutoRotationSpeed: queue.carouselAutoRotationSpeed,
    iconViewSize: queue.iconViewSize,
    iconGridClass: queue.iconGridClass,
    queueRowVariant: queue.queueRowVariant,
    progressUpdateIntervalMs: settings.progressUpdateIntervalMs,
    hasBatchCompressBatches: batchCompress.hasBatchCompressBatches,
    activeStatusFilters: queue.activeStatusFilters,
    activeTypeFilters: queue.activeTypeFilters,
    filterText: queue.filterText,
    filterUseRegex: queue.filterUseRegex,
    filterRegexError: queue.filterRegexError,
    sortPrimary: queue.sortPrimary,
    sortPrimaryDirection: queue.sortPrimaryDirection,
    hasSelection: queue.hasSelection,
    hasActiveFilters: queue.hasActiveFilters,
    selectedJobIds: queue.selectedJobIds,
    expandedBatchIds: batchCompress.expandedBatchIds,
    sortCompareFn: queue.compareJobsForDisplay,
  });

  queue.selectionBarPinned = selectionBarPinned;
  queue.setSelectionBarPinned = setSelectionBarPinned;
  queue.queueOutputPolicy = queueOutputPolicy;
  queue.setQueueOutputPolicy = setQueueOutputPolicy;
  queue.queuePanelProps = queuePanelProps;
  queue.queueTotalCount = queueTotalCount;

  const queueContextMenu = useQueueContextMenu({
    jobs,
    selectedJobIds: queue.selectedJobIds,
    handleWaitJob: queue.handleWaitJob,
    handleResumeJob: queue.handleResumeJob,
    handleRestartJob: queue.handleRestartJob,
    handleCancelJob: queue.handleCancelJob,
    bulkCancel: queue.bulkCancel,
    bulkWait: queue.bulkWait,
    bulkResume: queue.bulkResume,
    bulkRestart: queue.bulkRestart,
    bulkMoveToTop: queue.bulkMoveToTop,
    bulkMoveToBottom: queue.bulkMoveToBottom,
    bulkDelete: queue.bulkDelete,
    openJobDetail: dialogs.dialogManager.openJobDetail,
    openJobCompare: dialogs.dialogManager.openJobCompare,
  });

  const { queueContextMenuVisible } = queueContextMenu;

  const hasBlockingOverlay = computed(() => {
    const dm = dialogs.dialogManager;
    return (
      dm.wizardOpen.value ||
      dm.parameterPanelOpen.value ||
      dm.batchCompressOpen.value ||
      dm.jobDetailOpen.value ||
      dm.batchDetailOpen.value ||
      dm.previewOpen.value ||
      dm.jobCompareOpen.value ||
      dm.exitConfirmOpen.value ||
      dm.deletePresetDialogOpen.value ||
      dm.smartPresetImportOpen.value ||
      dm.importCommandsOpen.value ||
      presetsModule.presetPendingDelete.value != null ||
      presetsModule.presetsPendingBatchDelete.value.length > 0 ||
      queue.queueDeleteConfirmOpen.value ||
      dnd.waitingJobContextMenuVisible.value ||
      queueContextMenuVisible.value
    );
  });

  useBodyPointerEventsFailsafe({ hasBlockingOverlay });

  const { jobDetailLogText, jobDetailJob, highlightedLogHtml } = useJobLog({
    selectedJob: dialogManager.selectedJob,
    detailOpen: dialogManager.jobDetailOpen,
    pollIntervalMs: settings.progressUpdateIntervalMs,
  });

  const handleUpdateAppSettings = (next: AppSettings) => {
    settings.appSettings.value = next;
  };

  return {
    shell,
    dialogs,
    batchCompress,
    presetsModule,
    queue,
    media,
    preview,
    dnd,
    settings,
    updater,
    queueContextMenu,

    jobs,
    queueError,
    lastDroppedRoot,
    presets,
    presetsLoadedFromBackend,
    manualJobPresetId,

    currentTitle,
    currentSubtitle,
    completedCount,
    presetSortMode,
    presetViewMode,
    presetSelectionBarPinned,
    setPresetSelectionBarPinned,
    selectedJobForDetail,
    jobDetailJob,
    jobDetailLogText,
    highlightedLogHtml,
    handleImportSmartPackConfirmed,
    ffmpegResolvedPath,
    handleUpdateAppSettings,
    copyToClipboard,
  };
}

export type MainAppContext = ReturnType<typeof createMainAppContext>;

export const MAIN_APP_CONTEXT_KEY: InjectionKey<MainAppContext> = Symbol("MainAppContext");

export function provideMainAppContext(context: MainAppContext) {
  provide(MAIN_APP_CONTEXT_KEY, context);
}

export function useMainAppContext() {
  const context = inject(MAIN_APP_CONTEXT_KEY, null);
  if (!context) throw new Error("MainAppContext is not provided");
  return context;
}

export function useShellDomain() {
  return useMainAppContext().shell;
}

export function useDialogsDomain() {
  return useMainAppContext().dialogs;
}

export function useQueueDomain() {
  return useMainAppContext().queue;
}

export function usePresetsDomain() {
  return useMainAppContext().presetsModule;
}

export function useSettingsDomain() {
  return useMainAppContext().settings;
}

export function useMediaDomain() {
  return useMainAppContext().media;
}

export function usePreviewDomain() {
  return useMainAppContext().preview;
}
