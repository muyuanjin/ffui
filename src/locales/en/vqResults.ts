const vqResults = {
  title: "Quality prediction",
  loading: "Loading curve data…",
  unavailable: "Curve data not loaded (network or bundled snapshot required)",
  notApplicable: "This preset does not encode video, so quality prediction is not applicable.",
  noPreset: "Current command is not parsed as a preset, so quality prediction is unavailable.",
  noMatch: "Curve data loaded, but no matching curve for the current preset (pick a dataset below).",
  refresh: "Recompute",
  source: "Source",
  cachedAt: "Cached at",
  dataset: "Dataset",
  datasetAuto: "Auto (derived from current encoder/preset)",
  hardwareModel: "Hardware model (auto dataset)",
  metrics: {
    vmafLabel: "VMAF",
    vmafHelp: "0–100. Higher means closer to the source (perceptual metric; best for comparisons).",
    ssimLabel: "SSIM",
    ssimHelp: "0–1. Higher is better (structural similarity; tends to reflect structure/luma consistency).",
    fpsLabel: "FPS",
    fpsHelp: "Encoding speed (frames/sec). Measured on the snapshot environment, not your machine's actual FPS.",
    bitrateLabel: "Reference bitrate",
    bitrateHelp:
      "Used to pick a reference point on bitrate-quality curves: estimated from current quality settings within curve range; not your real output bitrate.",
  },
  note: "Predictions are derived from public curve snapshots and are best for selection/comparison, not a precise guarantee for any specific video.",
} as const;

export default vqResults;
