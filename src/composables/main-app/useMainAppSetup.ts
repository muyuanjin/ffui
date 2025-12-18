import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, FFmpegPreset, PresetSortMode, PresetViewMode, TranscodeJob } from "@/types";
import { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import { useMainAppSmartScan } from "@/composables/main-app/useMainAppSmartScan";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { useMainAppQueue } from "@/composables/main-app/useMainAppQueue";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import { useMainAppUpdater } from "@/composables/main-app/useMainAppUpdater";
import { useQueueOutputPolicy } from "@/composables/main-app/useQueueOutputPolicy";
import { useJobLog } from "@/composables";
import { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { hasTauri, saveAppSettings } from "@/lib/backend";
import { scheduleStartupIdle } from "./startupIdle";
import { useUiAppearanceSync } from "./useUiAppearanceSync";
import { useSmartScanQueueRefresh } from "./useSmartScanQueueRefresh";
export function useMainAppSetup() {
  const { t, locale } = useI18n();
  const jobs = ref<TranscodeJob[]>([]);
  const queueError = ref<string | null>(null);
  const lastQueueSnapshotAtMs = ref<number | null>(null);
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

  const smartScan = useMainAppSmartScan({
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
    presets,
    manualJobPresetId,
    compositeSmartScanTasks: smartScan.compositeSmartScanTasks,
    compositeTasksById: smartScan.compositeTasksById,
    onJobCompleted: presetsModule.handleCompletedJobFromBackend,
    startupIdleReady,
  });

  useSmartScanQueueRefresh({
    smartScanBatchMeta: smartScan.smartScanBatchMeta,
    jobs,
    refreshQueueFromBackend: queue.refreshQueueFromBackend,
  });

  const settings = useMainAppSettings({
    jobs,
    manualJobPresetId,
    smartConfig: smartScan.smartConfig,
    startupIdleReady,
  });
  useUiAppearanceSync(settings.appSettings);

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
    try {
      // 直接持久化当前快照，由 useAppSettings 的自动保存逻辑统一维护内存状态，
      // 避免异步返回的旧快照覆盖后续用户修改（例如固定操作栏开关）。
      await saveAppSettings(next);
    } catch (error) {
      console.error("Failed to mark onboardingCompleted in AppSettings", error);
    }
    settings.scheduleSaveSettings();
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

      // 恢复预设排序模式
      if (value.presetSortMode && value.presetSortMode !== presetSortMode.value) {
        presetSortMode.value = value.presetSortMode;
      }

      // 恢复预设视图模式
      if (value.presetViewMode && value.presetViewMode !== presetViewMode.value) {
        presetViewMode.value = value.presetViewMode;
      }

      // 自动打开智能预设导入对话框
      if (!value.onboardingCompleted && !autoOnboardingTriggered.value) {
        autoOnboardingTriggered.value = true;
        dialogs.dialogManager.openSmartPresetImport();
      }
    },
    { flush: "post" },
  );
  // 保存预设排序模式变化
  watch(
    presetSortMode,
    async (nextMode) => {
      if (!settings.appSettings.value || !hasTauri()) return;
      if (settings.appSettings.value.presetSortMode === nextMode) return;

      const nextSettings: AppSettings = {
        ...settings.appSettings.value,
        presetSortMode: nextMode,
      };
      settings.appSettings.value = nextSettings;

      try {
        // 仅持久化，而不再用异步返回值回写 appSettings，
        // 由共享的 useAppSettings 自动保存统一负责状态同步，避免状态竞争。
        await saveAppSettings(nextSettings);
      } catch (error) {
        console.error("Failed to save presetSortMode to AppSettings", error);
      }
      settings.scheduleSaveSettings();
    },
    { flush: "post" },
  );
  // 保存预设视图模式变化
  watch(
    presetViewMode,
    async (nextMode) => {
      if (!settings.appSettings.value || !hasTauri()) return;
      if (settings.appSettings.value.presetViewMode === nextMode) return;

      const nextSettings: AppSettings = {
        ...settings.appSettings.value,
        presetViewMode: nextMode,
      };
      settings.appSettings.value = nextSettings;

      try {
        await saveAppSettings(nextSettings);
      } catch (error) {
        console.error("Failed to save presetViewMode to AppSettings", error);
      }
      settings.scheduleSaveSettings();
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
      ...(current ?? ({ tools: {}, smartScanDefaults: {}, previewCapturePercent: 50 } as AppSettings)),
      selectionBarPinned: pinned,
    };
    // 直接更新 appSettings，useAppSettings 的 watch 会自动触发持久化
    settings.appSettings.value = nextSettings;
  };

  const { queueOutputPolicy, setQueueOutputPolicy } = useQueueOutputPolicy(settings.appSettings);
  const { dialogManager, selectedJobForDetail } = dialogs;
  // Best-effort resolution of concrete ffmpeg/ffprobe paths for UI display.
  // Prefer the backend-probed resolvedPath (which already accounts for
  // auto-download and PATH lookup) and fall back to the custom path stored in
  // AppSettings when status snapshots are not yet available.
  const ffmpegResolvedPath = computed(() => {
    const status = settings.toolStatuses.value.find((s) => s.kind === "ffmpeg");
    if (status?.resolvedPath) return status.resolvedPath;
    const tools = (settings.appSettings.value as any)?.tools as import("@/types").ExternalToolSettings | undefined;
    return tools?.ffmpegPath ?? null;
  });
  const queuePanelProps = createQueuePanelProps({
    queueJobsForDisplay: queue.queueJobsForDisplay,
    visibleQueueItems: queue.visibleQueueItems,
    iconViewItems: queue.iconViewItems,
    queueModeProcessingJobs: queue.queueModeProcessingJobs,
    queueModeWaitingItems: queue.queueModeWaitingItems,
    queueModeWaitingBatchIds: queue.queueModeWaitingBatchIds,
    pausingJobIds: queue.pausingJobIds,
    presets,
    queueViewMode: queue.queueViewMode,
    // Expand bare `ffmpeg` tokens in the "full command" view using the
    // backend-resolved executable path so users can copy the actual command.
    ffmpegResolvedPath,
    queueProgressStyleModel: queue.queueProgressStyleModel,
    queueMode: queue.queueMode,
    isIconViewMode: queue.isIconViewMode,
    iconViewSize: queue.iconViewSize,
    iconGridClass: queue.iconGridClass,
    queueRowVariant: queue.queueRowVariant,
    progressUpdateIntervalMs: settings.progressUpdateIntervalMs,
    hasSmartScanBatches: smartScan.hasSmartScanBatches,
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
    expandedBatchIds: smartScan.expandedBatchIds,
    sortCompareFn: queue.compareJobsForDisplay,
  });

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

  const {
    queueContextMenuVisible,
    queueContextMenuMode,
    queueContextMenuX,
    queueContextMenuY,
    queueContextMenuJob,
    queueContextMenuJobStatus,
    queueContextMenuCanRevealInputPath,
    queueContextMenuCanRevealOutputPath,
    openQueueContextMenuForJob,
    openQueueContextMenuForBulk,
    closeQueueContextMenu,
    handleQueueContextInspect,
    handleQueueContextCompare,
    handleQueueContextWait,
    handleQueueContextResume,
    handleQueueContextRestart,
    handleQueueContextCancel,
    handleQueueContextMoveToTop,
    handleQueueContextMoveToBottom,
    handleQueueContextDelete,
    handleQueueContextOpenInputFolder,
    handleQueueContextOpenOutputFolder,
    handleQueueContextCopyInputPath,
    handleQueueContextCopyOutputPath,
  } = queueContextMenu;

  const { jobDetailLogText, highlightedLogHtml } = useJobLog({
    selectedJob: dialogManager.selectedJob,
  });

  const handleUpdateAppSettings = (next: AppSettings) => {
    settings.appSettings.value = next;
  };

  const mainApp = {
    jobs,
    queueError,
    lastDroppedRoot,
    presets,
    presetsLoadedFromBackend,
    settings,
    ...shell,
    ...dialogs,
    ...smartScan,
    ...settings,
    ...updater,
    ...presetsModule,
    ...queue,
    ...media,
    ...preview,
    ...dnd,
    currentTitle,
    currentSubtitle,
    selectedJobForDetail,
    globalTaskbarProgressPercent: settings.globalTaskbarProgressPercent,
    compositeSmartScanTasks: smartScan.compositeSmartScanTasks,
    smartScanBatchMeta: smartScan.smartScanBatchMeta,
    jobDetailLogText,
    highlightedLogHtml,
    copyToClipboard,
    // Additional bindings used only by the template but not originally exposed on the instance.
    completedCount,
    presetSortMode,
    presetViewMode,
    selectionBarPinned,
    setSelectionBarPinned,
    queueOutputPolicy,
    setQueueOutputPolicy,
    queuePanelProps,
    handleImportSmartPackConfirmed,
    ffmpegResolvedPath,
    handleUpdateAppSettings,
    // Queue context menu bindings used by the template.
    queueContextMenuVisible,
    queueContextMenuMode,
    queueContextMenuX,
    queueContextMenuY,
    queueContextMenuJob,
    queueContextMenuJobStatus,
    queueContextMenuCanRevealInputPath,
    queueContextMenuCanRevealOutputPath,
    openQueueContextMenuForJob,
    openQueueContextMenuForBulk,
    closeQueueContextMenu,
    handleQueueContextInspect,
    handleQueueContextCompare,
    handleQueueContextWait,
    handleQueueContextResume,
    handleQueueContextRestart,
    handleQueueContextCancel,
    handleQueueContextMoveToTop,
    handleQueueContextMoveToBottom,
    handleQueueContextDelete,
    handleQueueContextOpenInputFolder,
    handleQueueContextOpenOutputFolder,
    handleQueueContextCopyInputPath,
    handleQueueContextCopyOutputPath,
  };
  return { mainApp, manualJobPresetId };
}
export type MainAppSetup = ReturnType<typeof useMainAppSetup>;
