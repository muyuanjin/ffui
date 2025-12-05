const media = {
  clearCurrent: "清空当前媒体",
  inspectError:
    "分析媒体文件失败，可能是 ffprobe 不可用、路径无效或文件格式不受支持。请在「软件设置」中检查 ffprobe 配置，或确认文件仍然存在且可访问。",
  chooseFile: "选择媒体文件…",
  inspecting: "正在分析…",
  emptyTitle: "拖拽或选择一个视频 / 图片文件",
  emptyDescription: "一次仅显示一个媒体文件，拖入新的文件时会自动替换前一个。",
  typeVideo: "视频",
  typeImage: "图片",
  dropTitle: "将媒体文件拖拽到窗口中",
  dropSubtitle: "释放鼠标即可只在「媒体信息」页中查看该文件的详细信息",
  sections: {
    preview: "预览",
    summary: "概要信息",
    format: "容器与格式",
    streams: "流信息",
    raw: "原始 ffprobe JSON",
  },
  copyRawJson: "复制原始 JSON",
  fields: {
    filePath: {
      label: "文件路径",
      tooltip: "媒体文件在磁盘上的完整绝对路径。",
    },
    fileName: {
      label: "文件名",
      tooltip: "媒体文件名称（不含目录路径）。",
    },
    fileType: {
      label: "类型",
      tooltip: "根据扩展名粗略判断是视频还是图片，仅作参考。",
    },
    fileSize: {
      label: "文件大小",
      tooltip: "来自文件系统的实际字节大小，显示时自动换算为 KB / MB / GB。",
    },
    createdAt: {
      label: "创建时间",
      tooltip: "文件在当前文件系统上的创建时间（如果底层平台支持）。",
    },
    modifiedAt: {
      label: "修改时间",
      tooltip: "最近一次写入该文件内容的时间。",
    },
    accessedAt: {
      label: "访问时间",
      tooltip: "最近一次访问该文件内容的时间（某些系统可能不会维护该时间）。",
    },
    duration: {
      label: "媒体时长",
      tooltip: "ffprobe 报告的总时长，格式为 时:分:秒。",
    },
    resolution: {
      label: "分辨率",
      tooltip: "视频画面的像素宽度与高度，例如 1920x1080。",
    },
    frameRate: {
      label: "帧率",
      tooltip: "主视频流的平均帧率（Frames Per Second, FPS）。",
    },
    videoCodec: {
      label: "视频编码",
      tooltip: "主视频流使用的编码格式，例如 h264、hevc、av1 等。",
    },
    audioCodec: {
      label: "音频编码",
      tooltip: "主音频流使用的编码格式，例如 aac、opus 等；若无音轨则为空。",
    },
    formatName: {
      label: "容器格式",
      tooltip: "ffprobe 报告的容器格式短名称，例如 mov,mp4,m4a,3gp 等。",
    },
    formatLongName: {
      label: "容器说明",
      tooltip: "容器格式的详细文字描述，例如 QuickTime / MOV / MP4。",
    },
    bitRate: {
      label: "整体码率",
      tooltip: "容器级别的平均码率，单位 kbps。",
    },
    tags: {
      label: "格式标签",
      tooltip: "附加在容器上的元数据标签，例如标题、艺术家等。",
    },
    streamCodec: {
      label: "流编码",
      tooltip: "该具体流（视频 / 音频 / 字幕等）使用的编码名称及可选说明。",
    },
    streamResolution: {
      label: "流分辨率",
      tooltip: "该视频流的分辨率，仅对视频流有效。",
    },
    streamFrameRate: {
      label: "流帧率",
      tooltip: "该视频流的帧率，仅在 ffprobe 提供该信息时可见。",
    },
    streamSampleRate: {
      label: "采样率",
      tooltip: "该音频流的采样率，单位 Hz，仅对音频流有效。",
    },
    streamChannels: {
      label: "声道数",
      tooltip: "该音频流包含的声道数量，例如 2 表示立体声，6 表示 5.1。",
    },
    streamLayout: {
      label: "声道布局",
      tooltip: "音频流的声道布局描述，例如 stereo、5.1 等。",
    },
    streamBitRate: {
      label: "流码率",
      tooltip: "该流自身的平均码率，单位 kbps。",
    },
    streamTags: {
      label: "流标签",
      tooltip: "附加在该流上的标签，例如语言、标题等。",
    },
  },
  noStreams: "ffprobe 未报告该媒体文件中包含任何流。",
} as const;

export default media;
