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
