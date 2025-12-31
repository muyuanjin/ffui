const vqResults = {
  title: "vq_results prediction",
  loading: "Loading benchmark data…",
  unavailable: "Benchmark data not loaded (network required)",
  notApplicable: "This preset does not encode video, so vq_results prediction is not applicable.",
  noPreset: "Current command is not parsed as a preset, so vq_results prediction is unavailable.",
  noMatch: "Benchmark data loaded, but no matching curve for the current preset (pick a dataset below).",
  refresh: "Refresh data",
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
    fpsHelp: "Encoding speed (frames/sec). Measured on vq_results environments, not your machine's actual FPS.",
    bitrateLabel: "Reference bitrate",
    bitrateHelp:
      "Used to pick a reference point on vq_results bitrate-quality curves: estimated from current quality settings within curve range; not your real output bitrate.",
  },
  note: "Predictions are derived from the public rigaya/vq_results curves and can change as upstream data updates. Use for selection/comparison rather than a precise guarantee for any specific video.",
} as const;

export default vqResults;
