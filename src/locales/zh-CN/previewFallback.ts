const previewFallback = {
  inspecting: "正在识别预览媒体…",
  probeFailed: "无法识别预览媒体",
  preparing: "正在生成兼容预览…",
  compatibleCopy: "正在播放或查看兼容预览副本，原文件未修改。",
  conversionFailed: "无法生成兼容预览",
  audioFailed: "无法播放此音频，请用系统播放器打开。",
  imageFailed: "无法显示此图片，请用系统应用打开。",
  title: "原生播放失败",
  nativePlaybackFailed: "WebView2 可能不支持该格式。可用帧预览，或用系统播放器打开。",
  hint: "拖动时会优先请求更快的低清帧；松手后会加载更清晰的帧。",
  loadingFrame: "正在加载预览帧…",
  noFrame: "暂无预览帧",
  scrub: "拖动预览",
  openInSystemPlayer: "用系统播放器打开",
} as const;

export default previewFallback;
