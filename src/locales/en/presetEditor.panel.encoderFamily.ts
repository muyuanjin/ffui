const presetEditorPanelEncoderFamily = {
  scenarioLabel: "Typical use",
  scenario: {
    share: "Sharing / upload",
    daily: "Daily viewing",
    archive: "Long‑term archive",
    lossless: "Visually (near) lossless",
    copyOnly: "Remux / stream copy only",
    audioOnly: "Audio loudness only",
    experimental: "Experimental / advanced",
  },
  encoderFamilyLabel: "Encoder & hardware",
  encoderFamily: {
    "cpu-x264": "H.264 software (CPU / libx264) — Best compatibility",
    "cpu-x265": "H.265/HEVC software (CPU / libx265) — Higher efficiency (slower)",
    "cpu-av1": "AV1 software (CPU / SVT-AV1) — High efficiency (slower)",
    "nvenc-h264": "H.264 NVIDIA hardware (NVENC) — High speed",
    "nvenc-hevc": "H.265/HEVC NVIDIA hardware (NVENC) — High speed",
    "nvenc-av1": "AV1 NVIDIA hardware (NVENC) — High efficiency",
    qsv: "Intel hardware (QSV / Quick Sync) — High speed",
    amf: "AMD hardware (AMF / Advanced Media Framework) — High speed",
    copy: "Copy (stream copy) — No re-encode / fastest",
    other: "Other encoder",
  },
} as const;

export default presetEditorPanelEncoderFamily;
