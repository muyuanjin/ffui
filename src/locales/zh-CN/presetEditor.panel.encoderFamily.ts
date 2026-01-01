const presetEditorPanelEncoderFamily = {
  scenarioLabel: "适用场景",
  scenario: {
    share: "分享 / 上传",
    daily: "日常观看",
    archive: "长期归档",
    lossless: "视觉无损 / 几乎无损",
    copyOnly: "仅封装 / 直拷贝",
    audioOnly: "仅音频标准化",
    experimental: "实验性 / 高阶玩法",
  },
  encoderFamilyLabel: "编码器与硬件",
  encoderFamily: {
    "cpu-x264": "H.264 软件编码（CPU / libx264）— 最佳兼容性",
    "cpu-x265": "H.265/HEVC 软件编码（CPU / libx265）— 更高压缩效率（更慢）",
    "cpu-av1": "AV1 软件编码（CPU / SVT-AV1）— 高效率（更慢）",
    "nvenc-h264": "H.264 NVIDIA 硬件编码（NVENC）— 高速",
    "nvenc-hevc": "H.265/HEVC NVIDIA 硬件编码（NVENC）— 高速",
    "nvenc-av1": "AV1 NVIDIA 硬件编码（NVENC）— 高效率",
    qsv: "Intel 硬件编码（QSV / Quick Sync）— 高速",
    amf: "AMD 硬件编码（AMF / Advanced Media Framework）— 高速",
    copy: "直拷贝（copy）— 不重编码 / 速度最快",
    other: "其他编码器",
  },
} as const;

export default presetEditorPanelEncoderFamily;
