const vqResults = {
  title: "画质预测",
  loading: "正在加载曲线数据…",
  unavailable: "未加载曲线快照（内置快照缺失或加载失败）",
  notApplicable: "当前预设未编码视频，因此不适用画质预测。",
  noPreset: "当前命令未解析为预设，因此无法给出画质预测。",
  noMatch: "已加载曲线数据，但当前预设未找到匹配曲线（请在下方选择数据集）。",
  refresh: "重新计算",
  source: "数据源",
  cachedAt: "缓存时间",
  dataset: "数据集",
  datasetAuto: "自动（按当前编码器/预设推断）",
  hardwareModel: "参考硬件（自动选集）",
  metrics: {
    vmafLabel: "VMAF",
    vmafHelp: "0–100，越高越接近原片（感知质量指标，适合横向对比）。",
    ssimLabel: "SSIM",
    ssimHelp: "0–1，越高越好（结构相似度指标，偏“结构/亮度”一致性）。",
    fpsLabel: "FPS",
    fpsHelp: "编码速度（帧/秒）。来自曲线快照的测试环境，不等同于你机器上的实际 FPS。",
    bitrateLabel: "参考码率",
    bitrateHelp:
      "用于在曲线的 bitrate-质量关系上选取参考点：按当前质量参数在曲线范围内近似估算；不等同于你实际输出码率。",
  },
  note: "这些预测来自公开测评曲线快照，用于“选型/对比”更合适；不应被当作对任意视频的精确承诺。",
} as const;

export default vqResults;
