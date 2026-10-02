const previewFallback = {
  inspecting: "Inspecting preview media…",
  probeFailed: "Unable to identify preview media",
  preparing: "Preparing a compatible preview…",
  compatibleCopy: "Playing or viewing a compatible preview copy. The original file is unchanged.",
  conversionFailed: "Unable to prepare a compatible preview",
  audioFailed: "Unable to play this audio. Open it in your system player.",
  imageFailed: "Unable to display this image. Open it in your system application.",
  title: "Native playback failed",
  nativePlaybackFailed:
    "WebView2 may not support this format. You can still scrub frames or open it in your system player.",
  hint: "While dragging, the app prefers faster low-quality frames; when you release, it loads a higher-quality frame.",
  loadingFrame: "Loading preview frame…",
  noFrame: "No preview frame yet",
  scrub: "Scrub",
  openInSystemPlayer: "Open in system player",
} as const;

export default previewFallback;
