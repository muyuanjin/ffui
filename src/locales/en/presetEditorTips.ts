const presetEditorTips = {
  crf_x264:
    "Constant Rate Factor (0-51). Lower = better quality and larger files; higher = smaller files and more artifacts. Recommended: 18-22 for archive, 23-24 for balance; above ~28 quality drops noticeably.",
  cq_nvenc:
    "Constant Quality (0-51). NOT directly comparable to CRF. Lower = better quality and higher bitrate. Recommended: 26-28 for everyday use; above ~32 will look visibly softer.",
  crf_av1:
    "AV1 CRF (0-63). Lower = better quality. Recommended: 32-34 as a general-purpose range, roughly similar to x264 CRF 23; above ~40 compression artifacts become obvious.",
  global_quality_qsv:
    "QSV uses -global_quality for quality-first control (lower = better). Recommended: HEVC 23-24; AV1 34.",
  qp_amf: "AMF uses -qp_i/-qp_p for quality control (lower = better). Recommended: QP 28 as a daily starting point.",
  quality_equivalence:
    "Suggested quality equivalence:\nlibx264 -crf 24\n= libx265 -crf 25\n= libsvtav1 -crf 30~34\n= h264_qsv -global_quality 24 (if available)\n= hevc_qsv -global_quality 23~24\n= h264_nvenc -cq 28~30\n= hevc_nvenc -cq 28~30\n= av1_nvenc -cq 34~36\n= h264_amf -qp_i 28 -qp_p 28\n= hevc_amf -qp_i 28 -qp_p 28",
  preset_x264: "'medium' is a good default. 'slow' yields smaller files at the same visual quality.",
  preset_nvenc:
    "Presets closer to 'p7' give better quality but encode slower; 'p5'/'p4' are common quality-speed trade-offs, while 'p1' is fastest but least efficient.",
  preset_av1: "Higher preset numbers are FASTER. Recommended: 4-6 for a good balance.",
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
  beginnerFriendlyLabel: "Beginner-friendly as a default preset",
  beginnerFriendlyYes: "Yes. Suitable as a daily/default preset.",
  beginnerFriendlyNo: "No. More advanced/specific; recommended only when you understand the settings.",
  mayIncreaseSizeWarning:
    "Hint: This preset may produce larger files than the source in some re-encode cases (e.g., the source is already highly compressed, and you use constqp/very low CRF). If you just want “slightly smaller than the source with similar quality”, prefer CQ/CRF balanced presets first.",
} as const;

export default presetEditorTips;
