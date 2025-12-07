const queue = {
  typeVideo: "VIDEO",
  typeImage: "IMAGE",
  skippedPrefix: "Skipped:",
  dropTitle: "Drop files to enqueue",
  dropSubtitle: "Release to create manual jobs in the transcode queue",
  viewModeLabel: "Queue view",
  viewModes: {
    compact: "Compact list",
    detail: "Detailed list",
    // The following modes will be progressively enabled in follow-up changes.
    iconSmall: "Small icon grid",
    iconMedium: "Medium icon grid",
    iconLarge: "Large icon grid",
    dynamicCard: "Dynamic cards",
  },
  modeLabel: "Queue mode",
  modes: {
    display: "View-only sort",
    queue: "Execution queue",
    displayLabelShort: "View-only sort",
    queueLabelShort: "Execution order queue",
    displayHint:
      "View-only sort: changes only the on-screen order and never affects the actual execution order. Drag-and-drop and priority-changing actions are disabled in this mode.",
    queueHint:
      "Execution order queue: the order of jobs in the Waiting group reflects the real execution priority. Drag-and-drop and 'move to top/bottom' control which jobs run first.",
  },
  progressStyleLabel: "Progress style",
  progressStyles: {
    bar: "Classic progress bar",
    cardFill: "Card background fill",
    rippleCard: "Ripple card",
  },
  groups: {
    processing: "Processing",
    waiting: "Waiting queue",
  },
  status: {
    completed: "completed",
    processing: "processing",
    paused: "paused",
    waiting: "waiting",
    queued: "queued",
    skipped: "skipped",
    failed: "failed",
    cancelled: "cancelled",
  },
  savedShort: "saved {percent}%",
  source: {
    manual: "Manual",
    smartScan: "Smart Scan",
  },
  filters: {
    label: "Filters",
    typeLabel: "Type",
    typeManual: "Manual transcode",
    typeSmartScan: "Compression (Smart Scan)",
    statusLabel: "Status",
    textLabel: "Conditions",
    textPlaceholder: "Filter by path, name, status, size or other fields (supports regex: and size>20mb)",
    reset: "Reset filters",
    summary: "Showing {visible} / {total} jobs",
    expand: "Show filters",
    collapse: "Hide filters",
    activeBadge: "Filters active",
    invalidRegex: "Invalid regular expression; keeping the previous valid filter.",
  },
  selection: {
    selectAll: "Select all",
    invert: "Invert selection",
    clear: "Clear selection",
    selectedCount: "Selected {count} job(s)",
  },
  sort: {
    label: "Sort",
    fields: {
      addedTime: "Added time",
      finishedTime: "Finished time",
      filename: "File name",
      status: "Status",
      duration: "Media duration",
      elapsed: "Elapsed processing time",
      progress: "Progress",
      type: "Job type",
      path: "Path",
      inputSize: "Input size",
      outputSize: "Output size",
      createdTime: "File created time",
      modifiedTime: "File modified time",
    },
    secondaryLabel: "Then by",
    asc: "Ascending",
    desc: "Descending",
    collapse: "Collapse secondary sort",
  },
  actions: {
    wait: "Wait",
    resume: "Resume",
    restart: "Restart",
    moveToPosition: "Move to position…",
    moveToPositionPrompt: "Enter a new queue position (1-{max}):",
    bulkCancel: "Stop selected",
    bulkWait: "Wait selected",
    bulkResume: "Resume selected",
    bulkRestart: "Restart selected",
    bulkMoveToTop: "Move to top",
    bulkMoveToBottom: "Move to bottom",
    bulkDelete: "Remove from list",
  },
  error: {
    loadFailed:
      "Failed to refresh queue state. Make sure the backend is running and external tools are configured.",
    enqueueFailed:
      "Failed to enqueue job. Please check external tool availability or auto-download settings.",
    cancelRejected:
      "The backend refused to cancel this job. It may have already finished or is not cancellable.",
    cancelFailed:
      "Error while cancelling job. Please retry later or verify external tool settings.",
    autoCompressFailed:
      "Smart Scan failed to call the backend and fell back to a simulated result. Check external tools or enable auto-download.",
    waitRejected:
      "The backend refused to put this job into wait state. It may have already finished or is not running.",
    waitFailed:
      "Error while applying the wait operation. Please retry later or verify external tool settings.",
    resumeRejected:
      "The backend refused to resume this job. Its state may have changed.",
    resumeFailed:
      "Error while resuming the job. Please retry later or verify external tool settings.",
    restartRejected:
      "The backend refused to restart this job. Its state may have changed.",
    restartFailed:
      "Error while restarting the job. Please retry later or verify external tool settings.",
    reorderRejected:
      "The backend refused to reorder the waiting queue. The queue may have changed.",
    reorderFailed:
      "Error while reordering the waiting queue. Please retry later or verify external tool settings.",
  },
} as const;

export default queue;
