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
      "Manage ffmpeg / ffprobe / avifenc availability, custom paths, and how the app manages these tools.",
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
    updateAvailableHint: "Update available: {version}",
    toolUpToDateHint: "Up to date",
    customToolPathFooter:
      "When a custom path is set, it takes precedence; otherwise the app searches the auto-downloaded tools directory or system PATH.",
    autoDownloadSectionTitle: "Auto-download & global behaviour",
    autoDownloadSectionDescription:
      "Choose how the app manages external tools, and configure preview capture and queue limits.",
    downloadStrategyLabel: "Management mode",
    toolModeAutoManagedLabel: "Full auto-manage",
    toolModeInstallOnlyLabel: "Install when missing",
    toolModeManualLabel: "Manual only",
    toolModeAutoManagedDescription:
      "Automatically installs ffmpeg / ffprobe / avifenc when missing and keeps them on the recommended version in the background.",
    toolModeInstallOnlyDescription:
      "Only auto-installs tools when the system has none available; once tools are usable, future updates are manual via the Download/Update button.",
    toolModeManualDescription:
      "Never auto-download or auto-update. The app uses only PATH or your custom paths, ideal for locked-down environments.",
    toolModeRecommendedBadge: "Recommended",
    toolModeCustomLabel: "Custom mode",
    toolModeCustomDescription:
      "Your current auto-download / auto-update switches do not match the three main modes. The app will follow your existing combination until you pick one of the modes above.",
    previewCaptureLabel: "Preview capture position (%)",
    previewCaptureHelp:
      "Percentage of total video duration used when capturing thumbnails; default is 25.",
    maxParallelJobsLabel: "Max parallel transcode jobs",
    maxParallelJobsHelp:
      "0 = auto (about half of logical CPU cores). Values > 0 pin the maximum to this number.",
    progressUpdateIntervalLabel: "Progress update interval (ms)",
    progressUpdateIntervalHelp:
      "Controls how often the backend reports ffmpeg progress and how much buffering the UI uses. Smaller values are more real-time; larger values are smoother.",
    metricsIntervalLabel: "Performance monitoring interval (ms)",
    metricsIntervalHelp:
      "Controls how frequently system performance metrics are sampled. Smaller values feel more continuous but cost more resources; larger values are cheaper but less real-time.",
    queuePersistenceLabel: "Queue crash-recovery persistence",
    queuePersistenceCrashRecoveryOption:
      "Persist queue state for crash recovery (may keep large logs on disk)",
    savingSettings: "Saving settings…",
    autoSaveHint: "Changes are saved automatically; no extra button is required.",
    saveErrorGeneric: "Failed to save settings. Please try again later.",
    devtoolsSectionTitle: "Developer tools",
    devtoolsSectionDescription:
      "Open Devtools from the desktop app to help with debugging and issue diagnosis.",
    devtoolsWindowHint:
      "Open Devtools.",
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
  minimize: "Minimize",
  maximize: "Maximize",
  close: "Close",
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
  monitor: {
    gpuStatus: "GPU STATUS",
    gpuCore: "CORE",
    gpuVram: "VRAM",
    gpuTemp: "TEMP",
    cpuHeatmap: "CPU CORES HEATMAP",
    cores: "CORES",
    networkIo: "NETWORK I/O",
    diskIo: "DISK I/O",
    read: "Read",
    write: "Write",
    rx: "RX",
    tx: "TX",
    cpuMemoryGpu: "CPU / MEMORY / GPU",
    cpu: "CPU",
    memory: "RAM",
    gpu: "GPU",
    systemUptime: "SYSTEM UPTIME",
    download: "↓",
    upload: "↑",
    reading: "R:",
    writing: "W:",
  },
} as const;

export default app;
