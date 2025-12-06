const app = {
  title: "FFUI - FFmpeg Transcoder",
  loading: "Starting transcoding console…",
  controlPanel: "Control Panel",
  tabs: {
    queue: "Transcode Queue",
    presets: "Parameter Presets",
    media: "Media Info",
    monitor: "Performance Monitor",
    settings: "Software Settings",
  },
  presetsHint: "Manage, edit, and delete your transcoding presets here.",
  queueHint: "Manage the transcoding queue, progress, and logs.",
  mediaHint: "Inspect media metadata and detailed analysis for a single file.",
  monitorHint: "Inspect CPU/GPU and other performance metrics.",
  settingsHint: "Configure external tool paths, auto-download, preview, and queue behaviour.",
  settings: {
    externalToolsTitle: "External tools",
    externalToolsDescription:
      "Manage ffmpeg / ffprobe / avifenc availability, custom paths, and auto-download status.",
    refreshToolsStatus: "Refresh status",
    toolStatus: {
      ready: "Ready",
      missing: "Not found",
    },
    currentToolPathLabel: "Resolved path",
    toolNotFoundHelp:
      "Executable not found; the app will try to auto-download it when needed (if enabled).",
    customToolPathLabel: "Custom path (takes precedence)",
    customToolPathPlaceholder: "Leave empty to search PATH or the auto-download directory",
    downloadStatusLabel: "Download / update status",
    downloadInProgress: "Downloading, please wait…",
    updateAvailableHint:
      "Update available; the tool will be auto-downloaded when needed.",
    customToolPathFooter:
      "When a custom path is set, it takes precedence; otherwise the app searches the auto-downloaded tools directory or system PATH.",
    autoDownloadSectionTitle: "Auto-download & global behaviour",
    autoDownloadSectionDescription:
      "Configure auto-download/update policies, preview capture position, and queue concurrency limits.",
    downloadStrategyLabel: "Download / update strategy",
    allowAutoDownloadLabel: "Allow auto-download (recommended)",
    allowAutoUpdateLabel: "Allow auto-update",
    previewCaptureLabel: "Preview capture position (%)",
    previewCaptureHelp:
      "Percentage of total video duration used when capturing thumbnails; default is 25.",
    maxParallelJobsLabel: "Max parallel transcode jobs",
    maxParallelJobsHelp:
      "0 = auto (about half of logical CPU cores). Values > 0 pin the maximum to this number.",
    progressUpdateIntervalLabel: "Progress update interval (ms)",
    progressUpdateIntervalHelp:
      "Controls how often the backend reports ffmpeg progress and how much buffering the UI uses. Smaller values are more real-time; larger values are smoother.",
    savingSettings: "Saving settings…",
    autoSaveHint: "Changes are saved automatically; no extra button is required.",
    saveErrorGeneric: "Failed to save settings. Please try again later.",
    devtoolsSectionTitle: "Developer tools",
    devtoolsSectionDescription:
      "Open Devtools from the desktop app to help with debugging and issue diagnosis.",
    devtoolsWindowHint:
      "Devtools will open in the desktop app window; no extra switch is required.",
    loadingSettings: "Loading application settings from backend…",
  },
  emptyQueue: {
    title: "No active jobs",
    subtitle: "Click Add transcode job or use the Smart Scan entry in the lower-left corner.",
  },
  queueDefaultPresetLabel: "Default preset for new jobs",
  queueDefaultPresetPlaceholder: "Select preset used when adding jobs",
  newPreset: "New Preset",
  lang: {
    label: "Language",
    zh: "中文",
    en: "English",
  },
  globalProgressLabel: "Overall queue progress",
  taskbarProgressModeLabel: "Taskbar progress mode",
  taskbarProgressModeHelp:
    "Controls how multiple jobs are combined into a single Windows taskbar progress bar.",
  taskbarProgressModes: {
    bySize: "Weight by input size (MB)",
    byDuration: "Weight by media duration",
    byEstimatedTime: "Weight by estimated processing time (recommended)",
  },
  openDevtools: "Open Devtools",
  openDevtoolsUnavailable:
    "Running in pure web mode; use your browser's devtools instead.",
  actions: {
    addJob: "Add transcode job",
    smartScan: "Add compression task",
    deletePreset: "Delete",
    confirmDelete: "Confirm delete",
    deletePresetConfirmTitle: "Delete preset",
    deletePresetConfirmMessage: "Are you sure you want to delete this preset?",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
  },
} as const;

export default app;
