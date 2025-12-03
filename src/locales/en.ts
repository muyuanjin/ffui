const en = {
  app: {
    title: "FFmpeg Transcoder",
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
    mediaHint: "Inspect media metadata and analysis (work in progress).",
    monitorHint: "Inspect CPU/GPU and other performance metrics.",
    settingsHint: "Configure external tool paths, auto-download, and preview settings.",
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
    actions: {
      addJob: "Add transcode job",
      smartScan: "Add compression task",
      deletePreset: "Delete",
      deletePresetConfirmTitle: "Delete preset",
      deletePresetConfirmMessage: "Are you sure you want to delete this preset?",
      cancel: "Cancel",
      confirm: "Confirm",
      close: "Close",
    },
  },
  common: {
    back: "Back",
    next: "Next",
    stepOf: "Step {step} of {total}",
  },
  presetEditor: {
    titleNew: "New Parameter Configuration",
    titleEdit: "Edit Configuration",
    untitled: "Untitled Preset",
    name: "Preset Name",
    namePlaceholder: "e.g., Archive HQ, Web 1080p",
    description: "Description",
    descriptionPlaceholder: "What is this preset used for?",
    recipes: {
      title: "Quick Recipes",
      hqArchive: "HQ Archive (CPU)",
      fastTranscode: "Fast Transcode (NVIDIA)",
      modernAv1: "Modern AV1",
      streamCopy: "Stream Copy / Remux",
    },
    video: {
      encoder: "Video Encoder",
      encoderPlaceholder: "Choose encoder",
      copyWarning: "Filters (Scale/Crop) will be disabled in Copy mode.",
      crfLabel: "Constant Rate Factor (CRF)",
      cqLabel: "Constant Quality (CQ)",
      presetLabel: "Preset (Speed vs Efficiency)",
      rateControlModeLabel: "Rate control mode",
      rateControlHelp:
        "CRF/CQ: quality-first (lower value = better quality, larger files). CBR/VBR: bitrate/size-first (requires a target bitrate). Two-pass makes quality more consistent at the same size but roughly doubles encode time.",
      bitrateKbpsLabel: "Target bitrate (kbps)",
      bitrateHelp:
        "Target average bitrate in kbps. Higher = more stable quality and larger files; lower = more artifacts. Rough guide: 720p ≈ 2–4Mbps, 1080p ≈ 4–8Mbps.",
      maxBitrateKbpsLabel: "Max peak bitrate (kbps)",
      maxBitrateKbpsHelp:
        "Caps bitrate spikes. Typically set somewhat above target bitrate (e.g. 4000k + maxrate 6000k). If set too low, complex scenes may look noticeably worse.",
      passLabel: "Two-pass encoding",
      passSingle: "Single pass",
      passFirst: "Pass 1 (analysis)",
      passSecond: "Pass 2 (encode)",
      passHelp:
        "Two-pass runs a fast analysis pass and then the real encode: more consistent quality at the same size, but total time is roughly 2× a single pass. Only meaningful for CBR/VBR.",
    },
    audio: {
      title: "Audio",
      copyTitle: "Copy (Passthrough)",
      copyDesc: "No quality loss, fastest.",
      aacTitle: "AAC (Convert)",
      aacDesc: "Compatible, compressed.",
      bitrateLabel: "Bitrate (kbps)",
      bitrate128: "128k (Standard)",
      bitrate192: "192k (High Quality)",
      bitrate320: "320k (Transparent)",
      bitrateHelp:
        "Higher bitrate = cleaner audio and fewer high-frequency artifacts. 128k is typical for video, 192k is a good default, 320k is effectively transparent for most listeners.",
    },
    filters: {
      title: "Filters",
      scaleLabel: "Scale (Resize)",
      scalePlaceholder: "e.g. -2:720 (Keep aspect, 720p height)",
      scaleHelp:
        "Use -1 or -2 for auto-calculation. -2 ensures even numbers (required for some codecs). Higher resolutions look sharper but increase file size; 720p/1080p are common trade-offs.",
    },
    actions: {
      update: "Update Preset",
      save: "Save Configuration",
      edit: "Edit",
      openPanel: "Open full parameter panel",
      backToWizard: "Back to wizard view",
    },
    tips: {
      crf_x264:
        "Constant Rate Factor (0-51). Lower = better quality and larger files; higher = smaller files and more artifacts. Recommended: 18-22 for archive, 23-24 for balance; above ~28 quality drops noticeably.",
      cq_nvenc:
        "Constant Quality (0-51). NOT directly comparable to CRF. Lower = better quality and higher bitrate. Recommended: 26-28 for everyday use; above ~32 will look visibly softer.",
      crf_av1:
        "AV1 CRF (0-63). Lower = better quality. Recommended: 32-34 as a general-purpose range, roughly similar to x264 CRF 23; above ~40 compression artifacts become obvious.",
      preset_x264:
        "'medium' is a good default. 'slow' yields smaller files at the same visual quality.",
      preset_nvenc: "'p7' has the highest quality, 'p1' is the fastest.",
      preset_av1: "Higher preset numbers are FASTER. Recommended: 4-6 for a good balance.",
    },
    summary: {
      title: "Preset summary",
    },
    advanced: {
      title: "Advanced (Raw ffmpeg command)",
      description:
        "Optionally define a full ffmpeg command template. Use INPUT and OUTPUT as placeholders.",
      enabledLabel: "Use custom command instead of generated options",
      templateLabel: "ffmpeg command template",
      templatePlaceholder: "ffmpeg -i INPUT -c:v libx264 -crf 23 -preset medium -c:a copy OUTPUT",
      previewTitle: "Command preview",
      copyButton: "Copy",
      copiedToast: "Command copied",
    },
    panel: {
      title: "Preset parameter panel",
      subtitle: "Tweak FFmpeg parameters by section, with a live command preview on the right.",
      globalTab: "Global & logs",
      inputTab: "Input & timeline",
      mappingTab: "Mapping & metadata",
      videoTab: "Video encoding",
      audioTab: "Audio & subtitles",
      filtersTab: "Filter chain",
      containerTab: "Container & segmenting",
      hardwareTab: "Hardware & bitstream",
      globalHelp:
        "Global flags such as -loglevel/-report/-stats currently use ffmpeg defaults; future versions will surface common switches here.",
      inputHelp:
        "Input/timeline options like -ss/-to/-t/-accurate_seek will become first-class fields later. This version keeps ffmpeg defaults.",
      mappingHelp:
        "Mapping/metadata options (-map/-map_metadata/-disposition, etc.) are auto-managed for now and will be editable here in future versions.",
      containerHelp:
        "Container/segment options (-f/-movflags/-segment_*/-hls_*, etc.) are currently inferred from file extension; key toggles will be added here.",
      hardwareHelp:
        "Hardware acceleration and bitstream filters (-hwaccel/-bsf, etc.) are currently implied by the chosen encoder; future iterations will expose them as explicit options.",
    },
  },
  smartScan: {
    title: "Smart Auto-Compression",
    subtitle: "Recursively scan and compress media.",
    notice:
      "Files matching specific criteria (already efficient codec, small size, or low compression gain) will be automatically Skipped.",
    videoStrategy: "Video Strategy",
    targetPreset: "Target Preset",
    minVideoSize: "Skip if smaller than (MB)",
    imageStrategy: "Image Strategy",
    targetFormat: "Target Format",
    minImageSize: "Skip if smaller than (KB)",
    minSavingRatioLabel: "Minimum Saving Ratio to Keep Result",
    minSavingRatioHelp:
      "If compressed file is larger than {ratio}% of original, it will be discarded (Not worth it).",
    scanButton: "Scan & Compress",
  },
  taskDetail: {
    title: "Task details",
    description: "Inspect media, paths, command, and logs for this transcoding job.",
    noPreview: "No preview thumbnail available",
    presetLabel: "Preset",
    unknownPreset: "Unknown preset ({id})",
    sizeLabel: "Input size",
    outputSizeLabel: "Output size",
    durationLabel: "Processing time",
    pathsTitle: "Paths",
    inputPath: "Input",
    outputPath: "Output",
    mediaInfoTitle: "Media info",
    codecLabel: "Codec",
    resolutionLabel: "Resolution",
    frameRateLabel: "Frame rate",
    mediaInfoFallback: "No media metadata available for this job.",
    commandTitle: "ffmpeg command",
    copyCommand: "Copy command",
    commandFallback: "Command line is not available for this job.",
    logsTitle: "Logs",
    copyLogs: "Copy logs",
    showFullLog: "Show full log",
    showTail: "Show tail only",
    failureReasonPrefix: "Failure reason:",
  },
  queue: {
    typeVideo: "VIDEO",
    typeImage: "IMAGE",
    skippedPrefix: "Skipped:",
    status: {
      completed: "completed",
      processing: "processing",
      waiting: "waiting",
      skipped: "skipped",
      failed: "failed",
      cancelled: "cancelled",
    },
    savedShort: "saved {percent}%",
    source: {
      manual: "Manual",
      smartScan: "Smart Scan",
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
    },
  },
  presets: {
    usedTimes: "Used {count} times",
    totalIn: "Total input: {gb} GB",
    videoLabel: "Video",
    audioLabel: "Audio",
    audioCopy: "Copy",
    audioAac: "AAC {kbps}k",
    avgRatio: "Avg compression: {percent}%",
    avgSpeed: "Avg speed: {mbps} MB/s",
  },
  stats: {
    empty: "Run some jobs first; stats will show up here.",
    compressionTitle: "Average Compression Ratio (%)",
    speedTitle: "Processing Speed (MB/s)",
  },
} as const;

export default en;
