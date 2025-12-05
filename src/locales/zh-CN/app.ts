const app = {
  title: "FFUI 转码控制台",
  loading: "正在启动转码控制台…",
  controlPanel: "控制面板",
  tabs: {
    queue: "任务队列",
    presets: "参数预设",
    media: "媒体信息",
    monitor: "性能监控",
    settings: "软件设置",
  },
  presetsHint: "在这里管理、编辑和删除你的转码参数预设。",
  queueHint: "管理转码任务队列，查看进度、预览和日志。",
  mediaHint: "查看单个媒体文件的元数据与详细分析。",
  monitorHint: "查看 CPU / GPU 等性能指标。",
  settingsHint: "配置外部工具路径、自动下载、预览以及队列相关行为。",
  emptyQueue: {
    title: "当前没有任务",
    subtitle: "点击左侧的添加转码任务，或者使用左下角的智能扫描入口。",
  },
  queueDefaultPresetLabel: "默认参数预设",
  queueDefaultPresetPlaceholder: "选择用于添加任务的预设",
  newPreset: "新建预设",
  lang: {
    label: "语言",
    zh: "中文",
    en: "English",
  },
  globalProgressLabel: "整体队列进度",
  taskbarProgressModeLabel: "任务栏进度计算方式",
  taskbarProgressModeHelp:
    "决定多个任务如何汇总成一个 Windows 任务栏进度条，用于避免进度倒退这类现象。",
  taskbarProgressModes: {
    bySize: "按输入体积加权（MB）",
    byDuration: "按媒体时长加权",
    byEstimatedTime: "按预估耗时加权（推荐）",
  },
  openDevtools: "打开开发者工具",
  openDevtoolsUnavailable: "当前运行在纯网页模式，无法通过应用内按钮打开开发者工具。",
  actions: {
    addJob: "添加转码任务",
    smartScan: "添加压缩任务",
    deletePreset: "删除",
    confirmDelete: "确认删除",
    deletePresetConfirmTitle: "删除预设",
    deletePresetConfirmMessage: "确定要删除这个预设吗？",
    cancel: "取消",
    confirm: "确认删除",
    close: "关闭",
  },
} as const;

export default app;
