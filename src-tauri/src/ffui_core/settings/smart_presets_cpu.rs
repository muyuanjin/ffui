use super::preset_templates::{base_preset, filters_empty, video_svtav1_crf, video_x264_crf};
use crate::ffui_core::domain::FFmpegPreset;

pub(crate) fn smart_presets_for_cpu_only() -> Vec<FFmpegPreset> {
    vec![
        base_preset(
            "smart-hevc-fast",
            "H.264 Fast",
            "x264 CRF 23 preset medium keeping source resolution for fast, broadly compatible output.",
            video_x264_crf(23, "medium", Some("yuv420p")),
            filters_empty(),
            Some(true),
        ),
        base_preset(
            "smart-hevc-archive",
            "H.264 Archival",
            "x264 CRF 18 preset slow for near visually lossless archival.",
            video_x264_crf(18, "slow", Some("yuv420p")),
            filters_empty(),
            Some(true),
        ),
        base_preset(
            "smart-av1-fast",
            "AV1 Fast (SVT)",
            "libsvtav1 CRF 34 preset 6, 10-bit output keeping source resolution for high-efficiency fast compression.",
            video_svtav1_crf(34, "6", Some("yuv420p10le"), Some(240), Some(3)),
            filters_empty(),
            Some(true),
        ),
        base_preset(
            "smart-av1-archive",
            "AV1 Archival (SVT)",
            "libsvtav1 CRF 24 preset 6, 10-bit output tuned for visually lossless archival.",
            video_svtav1_crf(24, "6", Some("yuv420p10le"), Some(240), Some(3)),
            filters_empty(),
            Some(true),
        ),
    ]
}
